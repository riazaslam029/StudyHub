import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as Speech from 'expo-speech';
import {
  BookOpen,
  CheckSquare,
  Code,
  FileText,
  Heading1,
  Image as ImageIcon,
  Paperclip,
  Plus,
  Share2,
  Sparkles,
  Trash2,
  Volume2,
  X,
} from 'lucide-react-native';
import { extractTextFromFile, generateFlashcardsFromText } from '../ai';
import { Button, Card, Empty, Heading, Input, Row, Screen } from '../components';
import {
  deleteAttachment,
  deleteNote,
  getAttachments,
  getNotes,
  getSubjects,
  saveAttachment,
  saveFlashcards,
  saveNote,
  updateNote,
} from '../db';
import { AppTheme } from '../theme';
import { Note, NoteBlock, Subject } from '../types';
import { VoiceInputButton } from '../voice';

const FILES_DIR = `${FileSystem.documentDirectory}studyhub_files/`;

async function ensureFilesDirectory() {
  const info = await FileSystem.getInfoAsync(FILES_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(FILES_DIR, { intermediates: true });
  }
}

function noteText(note: Note) {
  try {
    return (JSON.parse(note.content_json) as NoteBlock[])
      .map((block) => {
        if (block.type === 'checkbox') return `${block.checked ? '[x]' : '[ ]'} ${block.text ?? ''}`;
        if (block.type === 'heading') return `# ${block.text ?? ''}`;
        if (block.type === 'bullet') return `• ${block.text ?? ''}`;
        if (block.type === 'code') return `\`\`\`\n${block.text ?? ''}\n\`\`\``;
        if (block.type === 'image') return `[Image: ${block.caption ?? 'Attachment'}]`;
        return block.text ?? '';
      })
      .filter(Boolean)
      .join('\n\n');
  } catch {
    return '';
  }
}

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type StagedAttachment = {
  id?: number;
  file_path: string;
  file_type: string;
  original_filename: string;
  file_size: number;
};

export function NotesScreen({ theme, navigation }: { theme: AppTheme; navigation: any }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [query, setQuery] = useState('');

  // Editor Modal / Sheet
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [blocks, setBlocks] = useState<NoteBlock[]>([]);
  const [attachments, setAttachments] = useState<StagedAttachment[]>([]);
  const [subjectId, setSubjectId] = useState<number | undefined>();
  const [extractingAi, setExtractingAi] = useState(false);

  // Focus reading mode & TTS
  const [reading, setReading] = useState<Note | null>(null);
  const [rate, setRate] = useState(1);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [generating, setGenerating] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const [nextNotes, nextSubjects] = await Promise.all([getNotes(query), getSubjects()]);
    // Load attachment counts for notes
    const withAttachments = await Promise.all(
      nextNotes.map(async (n) => {
        const atts = await getAttachments(n.id);
        return { ...n, attachments: atts };
      })
    );
    setNotes(withAttachments);
    setSubjects(nextSubjects);
  }, [query]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void ensureFilesDirectory();
      return () => {
        Speech.stop();
      };
    }, [refresh])
  );

  useEffect(() => {
    return () => {
      Speech.stop();
    };
  }, []);

  const openNewNote = () => {
    setEditingNoteId(null);
    setTitle('');
    setBlocks([{ id: String(Date.now()), type: 'paragraph', text: '' }]);
    setAttachments([]);
    setSubjectId(undefined);
    setEditorOpen(true);
  };

  const openEditNote = async (note: Note) => {
    setEditingNoteId(note.id);
    setTitle(note.title);
    try {
      const parsed = JSON.parse(note.content_json) as NoteBlock[];
      setBlocks(parsed.length ? parsed : [{ id: String(Date.now()), type: 'paragraph', text: '' }]);
    } catch {
      setBlocks([{ id: String(Date.now()), type: 'paragraph', text: '' }]);
    }
    const atts = await getAttachments(note.id);
    setAttachments(atts);
    setSubjectId(note.subject_id ?? undefined);
    setEditorOpen(true);
  };

  // Block management
  const addBlock = (type: NoteBlock['type']) => {
    setBlocks((prev) => [...prev, { id: String(Date.now()), type, text: '' }]);
  };

  const updateBlockText = (id: string, text: string) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, text } : b)));
  };

  const toggleCheckbox = (id: string) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, checked: !b.checked } : b)));
  };

  const deleteBlock = (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  };

  // File Attachment: Image
  const handleAttachImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        return Alert.alert('Permission needed', 'Allow photo gallery access to attach images.');
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
      });

      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;

      // Check size (>10MB warning)
      if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) {
        const proceed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            'Large Image (>10MB)',
            `This image is ${(asset.fileSize! / (1024 * 1024)).toFixed(1)}MB. It will be compressed before saving. Continue?`,
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Attach', onPress: () => resolve(true) },
            ]
          );
        });
        if (!proceed) return;
      }

      await ensureFilesDirectory();

      // Compress image
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
      );

      const filename = `img_${Date.now()}.jpg`;
      const destination = `${FILES_DIR}${filename}`;
      await FileSystem.copyAsync({ from: manipulated.uri, to: destination });

      const fileInfo = await FileSystem.getInfoAsync(destination);
      const fileSize = fileInfo.exists && 'size' in fileInfo ? fileInfo.size : 0;

      const newAttachment: StagedAttachment = {
        file_path: destination,
        file_type: 'image/jpeg',
        original_filename: asset.fileName || filename,
        file_size: fileSize,
      };

      setAttachments((prev) => [...prev, newAttachment]);

      // Add inline image block
      setBlocks((prev) => [
        ...prev,
        {
          id: String(Date.now()),
          type: 'image',
          url: destination,
          caption: asset.fileName || 'Attached photo',
        },
      ]);

      Alert.alert('Image Attached', 'Image added as an inline block and saved locally.');
    } catch (e) {
      Alert.alert('Could not attach image', e instanceof Error ? e.message : 'Error processing image.');
    }
  };

  // File Attachment: Documents (PDF, DOCX, TXT)
  const handleAttachDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'text/plain',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/msword',
          '*/*',
        ],
        copyToCacheDirectory: true,
      });

      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;

      // Warn if file > 10MB
      if (asset.size && asset.size > 10 * 1024 * 1024) {
        const proceed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            'Large File Warning (>10MB)',
            `This file is ${(asset.size! / (1024 * 1024)).toFixed(1)}MB. Attaching large files uses local device storage. Continue?`,
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Attach', onPress: () => resolve(true) },
            ]
          );
        });
        if (!proceed) return;
      }

      await ensureFilesDirectory();

      const safeName = asset.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const destination = `${FILES_DIR}doc_${Date.now()}_${safeName}`;
      await FileSystem.copyAsync({ from: asset.uri, to: destination });

      const newAttachment: StagedAttachment = {
        file_path: destination,
        file_type: asset.mimeType || 'application/octet-stream',
        original_filename: asset.name,
        file_size: asset.size || 0,
      };

      setAttachments((prev) => [...prev, newAttachment]);
      Alert.alert('Document Attached', `"${asset.name}" attached cleanly.`);
    } catch (e) {
      Alert.alert('Could not attach document', e instanceof Error ? e.message : 'Error selecting file.');
    }
  };

  const handleOpenAttachment = async (att: StagedAttachment) => {
    try {
      const exists = (await FileSystem.getInfoAsync(att.file_path)).exists;
      if (!exists) {
        return Alert.alert('File not found', 'This local attachment could not be located.');
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(att.file_path, {
          mimeType: att.file_type,
          dialogTitle: att.original_filename,
        });
      } else {
        Alert.alert('File Location', att.file_path);
      }
    } catch (e) {
      Alert.alert('Could not open file', e instanceof Error ? e.message : 'Error previewing document.');
    }
  };

  const handleDeleteAttachment = async (index: number, att: StagedAttachment) => {
    if (att.id) {
      await deleteAttachment(att.id);
    }
    try {
      await FileSystem.deleteAsync(att.file_path, { idempotent: true });
    } catch {
      // ignore
    }
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    // Also remove inline image block if it points to this file
    setBlocks((prev) => prev.filter((b) => b.url !== att.file_path));
  };

  // Extract Text from File (AI Vision / OCR / Text Reader)
  const handleExtractText = async (att: StagedAttachment) => {
    setExtractingAi(true);
    try {
      let extracted = '';
      const isImage = att.file_type.startsWith('image/') || /\.(jpg|jpeg|png)$/i.test(att.original_filename);
      const isPdf = att.file_type === 'application/pdf' || /\.pdf$/i.test(att.original_filename);
      const isTxt = att.file_type.startsWith('text/') || /\.txt$/i.test(att.original_filename);

      if (isTxt) {
        extracted = await FileSystem.readAsStringAsync(att.file_path, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      } else if (isImage || isPdf) {
        const base64 = await FileSystem.readAsStringAsync(att.file_path, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const mimeType = isPdf ? 'application/pdf' : 'image/jpeg';
        extracted = await extractTextFromFile({
          base64,
          mimeType,
          fileName: att.original_filename,
        });
      } else {
        return Alert.alert(
          'Unsupported for AI Extraction',
          'AI text extraction is available for Images, PDFs, and Text files. Other file formats can still be opened and attached.'
        );
      }

      if (extracted.trim()) {
        setBlocks((prev) => [
          ...prev,
          {
            id: String(Date.now()),
            type: 'heading',
            text: `Extracted from: ${att.original_filename}`,
          },
          {
            id: String(Date.now() + 1),
            type: 'paragraph',
            text: extracted.trim(),
          },
        ]);
        Alert.alert(
          'Text Extracted & Inserted',
          `Successfully extracted text from "${att.original_filename}" and added it into your note blocks.`
        );
      } else {
        Alert.alert('Empty Text', 'No readable text could be found in this file.');
      }
    } catch (e) {
      Alert.alert(
        'Could not extract text',
        e instanceof Error ? e.message : 'Ensure Gemini key is configured in Settings.'
      );
    } finally {
      setExtractingAi(false);
    }
  };

  // Save Note & Persist Attachments
  const saveCurrentNote = async () => {
    if (!title.trim()) return Alert.alert('Give this note a title');

    // Clean blocks
    const cleanedBlocks = blocks.filter((b) => b.type === 'divider' || (b.text && b.text.trim()) || b.url);
    const contentJson = JSON.stringify(
      cleanedBlocks.length ? cleanedBlocks : [{ id: String(Date.now()), type: 'paragraph', text: '' }]
    );

    let noteId = editingNoteId;
    if (noteId) {
      await updateNote(noteId, title.trim(), contentJson);
    } else {
      const createdId = await saveNote({
        title: title.trim(),
        content_json: contentJson,
        folder_id: null,
        subject_id: subjectId ?? null,
      });
      noteId = Number(createdId);
    }

    // Persist staged attachments that aren't yet in db
    for (const att of attachments) {
      if (!att.id) {
        await saveAttachment({
          note_id: noteId,
          file_path: att.file_path,
          file_type: att.file_type,
          original_filename: att.original_filename,
          file_size: att.file_size,
        });
      }
    }

    setEditorOpen(false);
    void refresh();
  };

  const generate = async (note: Note) => {
    const content = noteText(note);
    if (!content) return Alert.alert('This note has no text to turn into flashcards.');
    setGenerating(note.id);
    try {
      const cards = await generateFlashcardsFromText(content);
      await saveFlashcards(cards, note.subject_id, note.id);
      Alert.alert('Flashcards ready', `${cards.length} cards were saved from “${note.title}”.`, [
        { text: 'Review now', onPress: () => navigation.navigate('Progress', { screen: 'Flashcards' }) },
        { text: 'Later' },
      ]);
    } catch (error) {
      Alert.alert(
        'Could not generate flashcards',
        error instanceof Error ? error.message : 'AI is temporarily unavailable, try again in a bit.'
      );
    } finally {
      setGenerating(null);
    }
  };

  const play = () => {
    if (!reading) return;
    Speech.stop();
    setPaused(false);
    setSpeaking(true);
    Speech.speak(noteText(reading), {
      rate,
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  };

  const closeReading = () => {
    Speech.stop();
    setSpeaking(false);
    setPaused(false);
    setReading(null);
  };

  return (
    <>
      <Screen theme={theme} scroll={false}>
        <Heading theme={theme} eyebrow="Your library">
          Notes
        </Heading>
        <Input
          theme={theme}
          value={query}
          onChangeText={setQuery}
          placeholder="Search notes, content, or attachments"
        />
        <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
          Notion-style blocks, file attachments (PDF/images), AI text extraction, and flashcards.
        </Text>

        <FlatList
          data={notes}
          keyExtractor={(note) => String(note.id)}
          style={{ flex: 1 }}
          contentContainerStyle={{ gap: 10, paddingBottom: 16 }}
          renderItem={({ item: note }) => {
            const preview = noteText(note);
            const attCount = note.attachments?.length ?? 0;
            return (
              <Card theme={theme}>
                <Pressable onPress={() => void openEditNote(note)}>
                  <Row
                    theme={theme}
                    title={note.title}
                    subtitle={`${note.subject_name ?? 'Unsorted'}${attCount > 0 ? ` · 📎 ${attCount} attached` : ''} · ${preview || 'Empty note'}`}
                    right={
                      <View style={{ flexDirection: 'row', gap: 13, alignItems: 'center' }}>
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            setReading(note);
                          }}
                        >
                          <BookOpen color={theme.colors.positive} size={20} />
                        </Pressable>
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            setReading(note);
                            setPaused(false);
                            setSpeaking(true);
                            Speech.stop();
                            Speech.speak(noteText(note), {
                              rate,
                              onDone: () => setSpeaking(false),
                              onStopped: () => setSpeaking(false),
                              onError: () => setSpeaking(false),
                            });
                          }}
                        >
                          <Volume2 color={theme.colors.warning} size={20} />
                        </Pressable>
                        <Pressable
                          disabled={generating !== null}
                          onPress={(e) => {
                            e.stopPropagation();
                            void generate(note);
                          }}
                        >
                          <Sparkles
                            color={generating === note.id ? theme.colors.muted : theme.colors.accent}
                            size={20}
                          />
                        </Pressable>
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            Alert.alert('Delete note?', 'This note and its attachments will be permanently removed.', [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Delete',
                                style: 'destructive',
                                onPress: async () => {
                                  await deleteNote(note.id);
                                  void refresh();
                                },
                              },
                            ]);
                          }}
                        >
                          <Trash2 color={theme.colors.danger} size={18} />
                        </Pressable>
                      </View>
                    }
                  />
                </Pressable>
                {generating === note.id ? (
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>AI is creating flashcards…</Text>
                ) : null}
              </Card>
            );
          }}
          ListEmptyComponent={
            <Empty
              theme={theme}
              title="Your library is ready"
              detail="Capture lecture blocks, code, voice notes, or attach files before they slip away."
            />
          }
          ListFooterComponent={
            <View style={{ marginTop: 12 }}>
              <Button theme={theme} label="New note" onPress={openNewNote} />
            </View>
          }
        />
      </Screen>

      {/* FULL NOTE EDITOR & ATTACHMENT MODAL */}
      <Modal visible={editorOpen} animationType="slide" onRequestClose={() => setEditorOpen(false)}>
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
          {/* Header */}
          <View
            style={{
              paddingTop: 48,
              paddingHorizontal: 20,
              paddingBottom: 14,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: theme.colors.surface,
            }}
          >
            <View>
              <Text style={{ fontSize: 11, fontWeight: '800', color: theme.colors.accent, letterSpacing: 1 }}>
                {editingNoteId ? 'EDIT NOTE' : 'NEW NOTE'}
              </Text>
              <Text style={{ fontSize: 18, fontWeight: '800', color: theme.colors.text }}>
                {title || 'Untitled Note'}
              </Text>
            </View>
            <Pressable onPress={() => setEditorOpen(false)}>
              <X size={24} color={theme.colors.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
            {/* Note Title */}
            <Input
              theme={theme}
              label="Note Title"
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Distributed Systems Week 4"
            />

            {/* Course Picker */}
            <View style={{ gap: 6 }}>
              <Text style={{ fontWeight: '700', color: theme.colors.text }}>Link to Course</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                <Pressable
                  onPress={() => setSubjectId(undefined)}
                  style={{
                    padding: 8,
                    borderRadius: 9,
                    backgroundColor: subjectId === undefined ? theme.colors.accent : theme.colors.surfaceSoft,
                  }}
                >
                  <Text
                    style={{
                      fontWeight: '700',
                      fontSize: 12,
                      color: subjectId === undefined ? '#fff' : theme.colors.text,
                    }}
                  >
                    Unsorted
                  </Text>
                </Pressable>
                {subjects.map((s) => (
                  <Pressable
                    key={s.id}
                    onPress={() => setSubjectId(s.id)}
                    style={{
                      padding: 8,
                      borderRadius: 9,
                      backgroundColor: subjectId === s.id ? s.color : theme.colors.surfaceSoft,
                    }}
                  >
                    <Text
                      style={{
                        fontWeight: '700',
                        fontSize: 12,
                        color: subjectId === s.id ? '#fff' : theme.colors.text,
                      }}
                    >
                      {s.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* File Attachments Section */}
            <Card theme={theme} style={{ backgroundColor: theme.colors.surfaceSoft, gap: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Paperclip size={18} color={theme.colors.accent} />
                  <Text style={{ fontWeight: '800', color: theme.colors.text }}>
                    Attachments ({attachments.length})
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable
                    onPress={() => void handleAttachImage()}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingVertical: 5,
                      paddingHorizontal: 8,
                      borderRadius: 8,
                      backgroundColor: theme.colors.surface,
                    }}
                  >
                    <ImageIcon size={14} color={theme.colors.accent} />
                    <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.text }}>+ Image</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void handleAttachDocument()}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingVertical: 5,
                      paddingHorizontal: 8,
                      borderRadius: 8,
                      backgroundColor: theme.colors.surface,
                    }}
                  >
                    <FileText size={14} color={theme.colors.accent} />
                    <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.text }}>+ Document</Text>
                  </Pressable>
                </View>
              </View>

              {extractingAi && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
                  <ActivityIndicator color={theme.colors.accent} />
                  <Text style={{ color: theme.colors.accent, fontWeight: '700', fontSize: 12 }}>
                    Gemini AI is reading and extracting text from file…
                  </Text>
                </View>
              )}

              {attachments.length === 0 ? (
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                  Attach PDFs, DOCX slides, or photos. You can preview them or let AI extract text into your note.
                </Text>
              ) : (
                <View style={{ gap: 8 }}>
                  {attachments.map((att, idx) => {
                    const isImg = att.file_type.startsWith('image/');
                    const isPdf = att.file_type === 'application/pdf' || att.original_filename.endsWith('.pdf');
                    return (
                      <View
                        key={`${att.file_path}-${idx}`}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          backgroundColor: theme.colors.surface,
                          borderRadius: 12,
                          padding: 10,
                          gap: 10,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                        }}
                      >
                        {/* File Badge */}
                        <View
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 8,
                            backgroundColor: isImg
                              ? '#E8F5E9'
                              : isPdf
                                ? '#FFEBEE'
                                : theme.colors.surfaceSoft,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 10,
                              fontWeight: '900',
                              color: isImg ? '#2E7D32' : isPdf ? '#C62828' : theme.colors.text,
                            }}
                          >
                            {isImg ? 'IMG' : isPdf ? 'PDF' : 'DOC'}
                          </Text>
                        </View>

                        {/* File Info */}
                        <Pressable style={{ flex: 1 }} onPress={() => void handleOpenAttachment(att)}>
                          <Text
                            style={{ fontWeight: '700', color: theme.colors.text, fontSize: 13 }}
                            numberOfLines={1}
                          >
                            {att.original_filename}
                          </Text>
                          <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                            {formatBytes(att.file_size)} · Tap to open
                          </Text>
                        </Pressable>

                        {/* Actions */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Pressable
                            onPress={() => void handleExtractText(att)}
                            disabled={extractingAi}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 4,
                              paddingVertical: 4,
                              paddingHorizontal: 7,
                              borderRadius: 8,
                              backgroundColor: theme.colors.accentSoft,
                            }}
                          >
                            <Sparkles size={12} color={theme.colors.accent} />
                            <Text style={{ fontSize: 11, fontWeight: '800', color: theme.colors.accent }}>
                              Extract text
                            </Text>
                          </Pressable>

                          <Pressable
                            onPress={() => void handleOpenAttachment(att)}
                            style={{ padding: 4 }}
                          >
                            <Share2 size={16} color={theme.colors.muted} />
                          </Pressable>

                          <Pressable
                            onPress={() => void handleDeleteAttachment(idx, att)}
                            style={{ padding: 4 }}
                          >
                            <Trash2 size={16} color={theme.colors.danger} />
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </Card>

            {/* Block Editor Section */}
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontWeight: '800', color: theme.colors.text, fontSize: 16 }}>
                  Content Blocks
                </Text>
                <VoiceInputButton
                  theme={theme}
                  label="Dictate"
                  onTranscript={(text) => {
                    setBlocks((prev) => [
                      ...prev,
                      { id: String(Date.now()), type: 'paragraph', text },
                    ]);
                  }}
                />
              </View>

              {/* Render Blocks */}
              {blocks.map((block) => {
                if (block.type === 'heading') {
                  return (
                    <View key={block.id} style={{ gap: 4 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontSize: 11, fontWeight: '800', color: theme.colors.accent }}>
                          HEADING
                        </Text>
                        <Pressable onPress={() => deleteBlock(block.id)}>
                          <Trash2 size={14} color={theme.colors.danger} />
                        </Pressable>
                      </View>
                      <Input
                        theme={theme}
                        value={block.text ?? ''}
                        onChangeText={(t) => updateBlockText(block.id, t)}
                        placeholder="Heading text..."
                        style={{ fontSize: 18, fontWeight: '800' }}
                      />
                    </View>
                  );
                }

                if (block.type === 'checkbox') {
                  return (
                    <View
                      key={block.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        backgroundColor: theme.colors.surface,
                        padding: 8,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                      }}
                    >
                      <Pressable onPress={() => toggleCheckbox(block.id)}>
                        {block.checked ? (
                          <CheckSquare color={theme.colors.positive} size={20} />
                        ) : (
                          <View
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: 4,
                              borderWidth: 1.5,
                              borderColor: theme.colors.muted,
                            }}
                          />
                        )}
                      </Pressable>
                      <View style={{ flex: 1 }}>
                        <Input
                          theme={theme}
                          value={block.text ?? ''}
                          onChangeText={(t) => updateBlockText(block.id, t)}
                          placeholder="To-do item"
                          style={{
                            textDecorationLine: block.checked ? 'line-through' : 'none',
                            color: block.checked ? theme.colors.muted : theme.colors.text,
                          }}
                        />
                      </View>
                      <Pressable onPress={() => deleteBlock(block.id)}>
                        <Trash2 size={15} color={theme.colors.danger} />
                      </Pressable>
                    </View>
                  );
                }

                if (block.type === 'code') {
                  return (
                    <View key={block.id} style={{ gap: 4 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontSize: 11, fontWeight: '800', color: theme.colors.muted }}>
                          CODE BLOCK
                        </Text>
                        <Pressable onPress={() => deleteBlock(block.id)}>
                          <Trash2 size={14} color={theme.colors.danger} />
                        </Pressable>
                      </View>
                      <Input
                        theme={theme}
                        value={block.text ?? ''}
                        onChangeText={(t) => updateBlockText(block.id, t)}
                        placeholder="Paste code or snippets..."
                        multiline
                        style={{
                          fontFamily: 'monospace',
                          backgroundColor: '#1E2322',
                          color: '#A8FF9E',
                          borderRadius: 8,
                        }}
                      />
                    </View>
                  );
                }

                if (block.type === 'image') {
                  return (
                    <View
                      key={block.id}
                      style={{
                        gap: 8,
                        padding: 10,
                        backgroundColor: theme.colors.surface,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontSize: 11, fontWeight: '800', color: theme.colors.accent }}>
                          INLINE IMAGE
                        </Text>
                        <Pressable onPress={() => deleteBlock(block.id)}>
                          <Trash2 size={15} color={theme.colors.danger} />
                        </Pressable>
                      </View>
                      {block.url ? (
                        <Image
                          source={{ uri: block.url }}
                          style={{
                            width: '100%',
                            height: 220,
                            borderRadius: 10,
                            backgroundColor: theme.colors.surfaceSoft,
                          }}
                          resizeMode="cover"
                        />
                      ) : null}
                      <Input
                        theme={theme}
                        value={block.caption ?? ''}
                        onChangeText={(t) =>
                          setBlocks((prev) => prev.map((b) => (b.id === block.id ? { ...b, caption: t } : b)))
                        }
                        placeholder="Image caption or notes..."
                      />
                    </View>
                  );
                }

                // Default: paragraph
                return (
                  <View key={block.id} style={{ gap: 4 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: theme.colors.muted }}>
                        PARAGRAPH
                      </Text>
                      {blocks.length > 1 ? (
                        <Pressable onPress={() => deleteBlock(block.id)}>
                          <Trash2 size={14} color={theme.colors.danger} />
                        </Pressable>
                      ) : null}
                    </View>
                    <Input
                      theme={theme}
                      value={block.text ?? ''}
                      onChangeText={(t) => updateBlockText(block.id, t)}
                      placeholder="Write your study notes here…"
                      multiline
                    />
                  </View>
                );
              })}

              {/* Block Adder Toolbar */}
              <View
                style={{
                  flexDirection: 'row',
                  gap: 8,
                  flexWrap: 'wrap',
                  marginTop: 6,
                  paddingVertical: 8,
                }}
              >
                <Pressable
                  onPress={() => addBlock('paragraph')}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    padding: 8,
                    borderRadius: 8,
                    backgroundColor: theme.colors.surfaceSoft,
                  }}
                >
                  <Plus size={14} color={theme.colors.accent} />
                  <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.text }}>Paragraph</Text>
                </Pressable>

                <Pressable
                  onPress={() => addBlock('heading')}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    padding: 8,
                    borderRadius: 8,
                    backgroundColor: theme.colors.surfaceSoft,
                  }}
                >
                  <Heading1 size={14} color={theme.colors.accent} />
                  <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.text }}>Heading</Text>
                </Pressable>

                <Pressable
                  onPress={() => addBlock('checkbox')}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    padding: 8,
                    borderRadius: 8,
                    backgroundColor: theme.colors.surfaceSoft,
                  }}
                >
                  <CheckSquare size={14} color={theme.colors.accent} />
                  <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.text }}>Checklist</Text>
                </Pressable>

                <Pressable
                  onPress={() => addBlock('code')}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    padding: 8,
                    borderRadius: 8,
                    backgroundColor: theme.colors.surfaceSoft,
                  }}
                >
                  <Code size={14} color={theme.colors.accent} />
                  <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.text }}>Code</Text>
                </Pressable>
              </View>
            </View>

            {/* Save Button */}
            <View style={{ gap: 8, marginTop: 12, paddingBottom: 24 }}>
              <Button theme={theme} label="Save Note" onPress={() => void saveCurrentNote()} />
              <Button theme={theme} label="Cancel" variant="secondary" onPress={() => setEditorOpen(false)} />
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* FOCUS / READING MODE MODAL */}
      <Modal visible={!!reading} animationType="fade" onRequestClose={closeReading}>
        <View style={{ flex: 1, backgroundColor: '#0E1211', padding: 24, paddingTop: 48 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: '#E7A17F', fontWeight: '800', letterSpacing: 1 }}>FOCUS MODE</Text>
            <Pressable onPress={closeReading}>
              <X color="#F6F1E7" size={27} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingVertical: 32, gap: 22 }}>
            <Text style={{ color: '#F6F1E7', fontSize: 30, fontWeight: '800', lineHeight: 38 }}>
              {reading?.title}
            </Text>
            <Text style={{ color: '#E5E0D7', fontSize: 19, lineHeight: 32 }}>
              {reading ? noteText(reading) : ''}
            </Text>
          </ScrollView>
          <View style={{ gap: 9 }}>
            <View style={{ flexDirection: 'row', gap: 7, alignItems: 'center' }}>
              <Text style={{ color: '#AAAFA9' }}>Speed</Text>
              {[0.8, 1, 1.2].map((value) => (
                <Pressable
                  key={value}
                  onPress={() => setRate(value)}
                  style={{
                    padding: 7,
                    borderRadius: 8,
                    backgroundColor: rate === value ? '#C95732' : '#29312E',
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>{value}×</Text>
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button
                  theme={theme}
                  label={paused ? 'Resume' : speaking ? 'Pause' : 'Listen'}
                  onPress={() => {
                    if (!speaking) play();
                    else if (paused) {
                      Speech.resume();
                      setPaused(false);
                    } else {
                      Speech.pause();
                      setPaused(true);
                    }
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  theme={theme}
                  label="Stop"
                  variant="danger"
                  onPress={() => {
                    Speech.stop();
                    setSpeaking(false);
                    setPaused(false);
                  }}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
