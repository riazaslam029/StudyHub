import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { CheckCircle2, Circle, Mic, MicOff, Sparkles, Trash2, X } from 'lucide-react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { extractTaskFromSpokenNote } from '../ai';
import { Button, Card, DateField, Empty, Heading, Input, Row, Screen, Sheet } from '../components';
import { deleteTask, getSubjects, getTasks, saveTask, updateTaskStatus } from '../db';
import { rescheduleAllDueReminders, scheduleDueReminders } from '../notifications';
import { AppTheme } from '../theme';
import { Priority, Subject, Task, TaskStatus, TaskType } from '../types';
import { VoiceInputButton } from '../voice';

const types: TaskType[] = ['assignment', 'quiz', 'exam', 'todo'];
const priorities: Priority[] = ['low', 'medium', 'high'];

export function TasksScreen({ theme, route }: { theme: AppTheme; route: any }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [filter, setFilter] = useState<'all' | TaskStatus>('all');

  // Manual Add Task Sheet
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<TaskType>('assignment');
  const [priority, setPriority] = useState<Priority>('medium');
  const [due, setDue] = useState<Date | null>(null);
  const [notes, setNotes] = useState('');
  const [campusReminder, setCampusReminder] = useState(false);
  const [subjectId, setSubjectId] = useState<number | undefined>();

  // Voice Note -> Task Flow
  const [isVoiceRecordingOpen, setIsVoiceRecordingOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isAiProcessing, setIsAiProcessing] = useState(false);

  // Review & Confirm Modal
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewTitle, setReviewTitle] = useState('');
  const [reviewType, setReviewType] = useState<TaskType>('todo');
  const [reviewPriority, setReviewPriority] = useState<Priority>('medium');
  const [reviewDue, setReviewDue] = useState<Date | null>(null);
  const [reviewSubjectId, setReviewSubjectId] = useState<number | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewCampusReminder, setReviewCampusReminder] = useState(false);
  const [reviewTranscript, setReviewTranscript] = useState('');

  const refresh = useCallback(async () => {
    const [nextTasks, nextSubjects] = await Promise.all([
      getTasks(filter === 'all' ? {} : { status: filter }),
      getSubjects(),
    ]);
    setTasks(nextTasks);
    setSubjects(nextSubjects);
  }, [filter]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      if (route.params?.create) {
        setOpen(true);
        route.params.create = false;
      }
      if (route.params?.voiceTask) {
        route.params.voiceTask = false;
        startVoiceTaskFlow();
      }
    }, [refresh, route.params])
  );

  // Speech Recognition Listeners for Voice Task Flow
  useSpeechRecognitionEvent('start', () => {
    setIsListening(true);
  });

  useSpeechRecognitionEvent('end', () => {
    setIsListening(false);
  });

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript?.trim();
    if (text) {
      setTranscript(text);
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    setIsListening(false);
    if (event.error !== 'aborted') {
      Alert.alert('Speech recognition notice', event.message || 'Please speak clearly or type your task instead.');
    }
  });

  const startVoiceTaskFlow = async () => {
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        return Alert.alert(
          'Microphone permission needed',
          'StudyHub requires microphone permission to turn spoken notes into structured tasks.'
        );
      }
      setTranscript('');
      setIsVoiceRecordingOpen(true);
      setIsListening(true);
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: false,
      });
    } catch {
      Alert.alert('Microphone error', 'Could not start speech recognition.');
    }
  };

  const stopVoiceAndExtract = async () => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // ignore
    }
    setIsListening(false);

    const spokenText = transcript.trim();
    if (!spokenText) {
      setIsVoiceRecordingOpen(false);
      return Alert.alert('No speech recorded', 'Try speaking a task again.');
    }

    setIsAiProcessing(true);
    try {
      const currentSubjects = subjects.length ? subjects : await getSubjects();
      const draft = await extractTaskFromSpokenNote(spokenText, currentSubjects);

      // Populate review state
      setReviewTitle(draft.title);
      setReviewType(draft.type);
      setReviewPriority(draft.priority);
      setReviewSubjectId(draft.subject_id);
      setReviewDue(draft.due_at ? new Date(draft.due_at) : null);
      setReviewNotes(draft.notes ?? '');
      setReviewCampusReminder(false);
      setReviewTranscript(draft.raw_transcript);

      setIsVoiceRecordingOpen(false);
      setReviewOpen(true);
    } catch (err) {
      console.warn('[Voice Task] AI Extraction error:', err);
      // Fallback: If AI fails or user is offline, allow manual review with the raw transcript
      setReviewTitle(spokenText.slice(0, 60));
      setReviewType('todo');
      setReviewPriority('medium');
      setReviewSubjectId(null);
      setReviewDue(null);
      setReviewNotes('');
      setReviewCampusReminder(false);
      setReviewTranscript(spokenText);

      setIsVoiceRecordingOpen(false);
      setReviewOpen(true);

      const msg = err instanceof Error ? err.message : 'AI is temporarily unavailable.';
      Alert.alert(
        'Speech Transcribed',
        `AI could not fully parse this (${msg}). Your raw transcript was loaded so you can review and save it manually.`
      );
    } finally {
      setIsAiProcessing(false);
    }
  };

  const cancelVoiceRecording = () => {
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // ignore
    }
    setIsListening(false);
    setIsVoiceRecordingOpen(false);
    setTranscript('');
  };

  const confirmAndSaveVoiceTask = async () => {
    if (!reviewTitle.trim()) return Alert.alert('Add a title before saving');
    const dueAt = reviewDue ? reviewDue.toISOString() : null;
    const task = {
      title: reviewTitle.trim(),
      type: reviewType,
      priority: reviewPriority,
      subject_id: reviewSubjectId,
      due_at: dueAt,
      status: 'pending' as const,
      notes: reviewNotes.trim() || (reviewTranscript ? `Transcribed from: "${reviewTranscript}"` : null),
      recurring: null,
      campus_reminder: reviewCampusReminder ? 1 : 0,
    };

    const id = await saveTask(task);
    const remindersScheduled = await scheduleDueReminders({
      ...task,
      id: Number(id),
      created_at: new Date().toISOString(),
    });

    setReviewOpen(false);
    void refresh();

    if (!remindersScheduled && dueAt) {
      Alert.alert('Task saved', 'Allow notifications in Android Settings to receive deadline reminders.');
    } else {
      Alert.alert('Task Created', `"${task.title}" was saved to your tasks.`);
    }
  };

  // Manual create
  const create = async () => {
    if (!title.trim()) return Alert.alert('Add a title first');
    const dueAt = due ? due.toISOString() : null;
    const task = {
      title: title.trim(),
      type,
      priority,
      subject_id: subjectId ?? null,
      due_at: dueAt,
      status: 'pending' as const,
      notes,
      recurring: null,
      campus_reminder: campusReminder ? 1 : 0,
    };
    const id = await saveTask(task);
    const remindersScheduled = await scheduleDueReminders({
      ...task,
      id: Number(id),
      created_at: new Date().toISOString(),
    });
    setOpen(false);
    setTitle('');
    setDue(null);
    setNotes('');
    setCampusReminder(false);
    void refresh();
    if (!remindersScheduled && dueAt) {
      Alert.alert('Task saved', 'Allow notifications in Android Settings to receive deadline reminders.');
    }
  };

  return (
    <Screen theme={theme} scroll={false}>
      <Heading theme={theme} eyebrow="Deadlines, without dread">
        Tasks
      </Heading>

      <View style={{ flexDirection: 'row', gap: 7 }}>
        {(['all', 'pending', 'in-progress', 'done'] as const).map((value) => (
          <Pressable
            key={value}
            onPress={() => setFilter(value)}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 10,
              borderRadius: 99,
              backgroundColor: filter === value ? theme.colors.accent : theme.colors.surfaceSoft,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: '800',
                color: filter === value ? '#fff' : theme.colors.text,
              }}
            >
              {value === 'all' ? 'All' : value}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={tasks}
        keyExtractor={(task) => String(task.id)}
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 9, paddingBottom: 16 }}
        renderItem={({ item: task }) => {
          const overdue = !!task.due_at && new Date(task.due_at) < new Date() && task.status !== 'done';
          return (
            <Card theme={theme} style={overdue ? { borderColor: theme.colors.danger } : undefined}>
              <Row
                theme={theme}
                title={task.title}
                subtitle={`${task.type} · ${task.subject_name ?? 'Personal'}${task.due_at ? ` · ${new Date(task.due_at).toLocaleString()}` : ''}`}
                right={
                  <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                    <Pressable
                      onPress={async () => {
                        await updateTaskStatus(task.id, task.status === 'done' ? 'pending' : 'done');
                        await rescheduleAllDueReminders(await getTasks());
                        void refresh();
                      }}
                    >
                      {task.status === 'done' ? (
                        <CheckCircle2 color={theme.colors.positive} />
                      ) : (
                        <Circle color={theme.colors.muted} />
                      )}
                    </Pressable>
                    <Pressable
                      onPress={async () => {
                        await deleteTask(task.id);
                        await rescheduleAllDueReminders(await getTasks());
                        void refresh();
                      }}
                    >
                      <Trash2 size={17} color={theme.colors.danger} />
                    </Pressable>
                  </View>
                }
              />
              {overdue ? (
                <Text style={{ fontSize: 12, fontWeight: '800', color: theme.colors.danger }}>OVERDUE</Text>
              ) : null}
            </Card>
          );
        }}
        ListEmptyComponent={
          <Empty
            theme={theme}
            title="All clear for now"
            detail="Add a deadline or speak a voice note to stay on track."
          />
        }
        ListFooterComponent={
          <View style={{ gap: 8, marginTop: 12 }}>
            <Button
              theme={theme}
              label="Voice Task (AI Auto-Draft)"
              variant="secondary"
              onPress={() => void startVoiceTaskFlow()}
            />
            <Button theme={theme} label="Add task manually" onPress={() => setOpen(true)} />
          </View>
        }
      />

      {/* VOICE RECORDING MODAL */}
      <Modal visible={isVoiceRecordingOpen} transparent animationType="slide" onRequestClose={cancelVoiceRecording}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 24,
              gap: 16,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Sparkles size={20} color={theme.colors.accent} />
                <Text style={{ fontSize: 18, fontWeight: '800', color: theme.colors.text }}>
                  Voice Note → Auto Task
                </Text>
              </View>
              <Pressable onPress={cancelVoiceRecording}>
                <X size={22} color={theme.colors.muted} />
              </Pressable>
            </View>

            <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 18 }}>
              Speak naturally! For example: “Submit Operating Systems lab assignment by next Tuesday 4 PM with high priority.”
            </Text>

            {/* Listening Indicator */}
            <View
              style={{
                alignItems: 'center',
                paddingVertical: 20,
                backgroundColor: isListening ? theme.colors.accentSoft : theme.colors.surfaceSoft,
                borderRadius: 16,
                gap: 10,
              }}
            >
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  backgroundColor: isListening ? theme.colors.accent : theme.colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {isListening ? <Mic size={32} color="#fff" /> : <MicOff size={32} color="#fff" />}
              </View>
              <Text style={{ fontWeight: '800', color: isListening ? theme.colors.accent : theme.colors.muted }}>
                {isListening ? 'Listening… speak now' : 'Processing speech…'}
              </Text>
            </View>

            {/* Live Transcript Display */}
            <View
              style={{
                minHeight: 70,
                padding: 12,
                borderRadius: 12,
                backgroundColor: theme.colors.surfaceSoft,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Text style={{ color: theme.colors.muted, fontSize: 11, fontWeight: '700', marginBottom: 4 }}>
                LIVE TRANSCRIPT:
              </Text>
              <Text style={{ color: theme.colors.text, fontSize: 15, fontStyle: transcript ? 'normal' : 'italic' }}>
                {transcript || 'Start speaking your task…'}
              </Text>
            </View>

            {isAiProcessing ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 }}>
                <ActivityIndicator color={theme.colors.accent} />
                <Text style={{ color: theme.colors.text, fontWeight: '700' }}>AI is extracting task details…</Text>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button theme={theme} label="Cancel" variant="secondary" onPress={cancelVoiceRecording} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    theme={theme}
                    label="Done & Review"
                    disabled={!transcript.trim()}
                    onPress={() => void stopVoiceAndExtract()}
                  />
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* REVIEW & CONFIRM MODAL (AI PRE-FILLED DRAFT) */}
      <Modal visible={reviewOpen} animationType="slide" onRequestClose={() => setReviewOpen(false)}>
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
          <View
            style={{
              paddingTop: 48,
              paddingHorizontal: 20,
              paddingBottom: 16,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: theme.colors.surface,
            }}
          >
            <View>
              <Text style={{ fontSize: 12, fontWeight: '800', color: theme.colors.accent, letterSpacing: 1 }}>
                AI EXTRACTED TASK
              </Text>
              <Text style={{ fontSize: 20, fontWeight: '800', color: theme.colors.text }}>
                Review Before Saving
              </Text>
            </View>
            <Pressable onPress={() => setReviewOpen(false)}>
              <X size={24} color={theme.colors.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
            {/* Raw Speech Box */}
            <Card theme={theme} style={{ backgroundColor: theme.colors.surfaceSoft }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Mic size={16} color={theme.colors.accent} />
                <Text style={{ fontWeight: '800', fontSize: 12, color: theme.colors.accent }}>
                  WHAT YOU SAID (RAW TRANSCRIPT):
                </Text>
              </View>
              <Input
                theme={theme}
                value={reviewTranscript}
                onChangeText={setReviewTranscript}
                multiline
                placeholder="Spoken words"
              />
              <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>
                If speech-to-text was unclear, you can edit it above. AI drafted the fields below.
              </Text>
            </Card>

            {/* Editable Draft Fields */}
            <Input
              theme={theme}
              label="Task Title"
              value={reviewTitle}
              onChangeText={setReviewTitle}
              placeholder="Task title"
            />

            <Choice
              label="Type"
              values={types}
              selected={reviewType}
              set={(val) => setReviewType(val as TaskType)}
              theme={theme}
            />

            <Choice
              label="Priority"
              values={priorities}
              selected={reviewPriority}
              set={(val) => setReviewPriority(val as Priority)}
              theme={theme}
            />

            {/* Matched Subject */}
            <View style={{ gap: 6 }}>
              <Text style={{ fontWeight: '700', color: theme.colors.text }}>Course (optional)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                <Pressable
                  onPress={() => setReviewSubjectId(null)}
                  style={{
                    padding: 8,
                    borderRadius: 9,
                    backgroundColor: reviewSubjectId === null ? theme.colors.accent : theme.colors.surfaceSoft,
                  }}
                >
                  <Text
                    style={{
                      fontWeight: '700',
                      fontSize: 12,
                      color: reviewSubjectId === null ? '#fff' : theme.colors.text,
                    }}
                  >
                    Personal / None
                  </Text>
                </Pressable>
                {subjects.map((sub) => (
                  <Pressable
                    key={sub.id}
                    onPress={() => setReviewSubjectId(sub.id)}
                    style={{
                      padding: 8,
                      borderRadius: 9,
                      backgroundColor: reviewSubjectId === sub.id ? sub.color : theme.colors.surfaceSoft,
                    }}
                  >
                    <Text
                      style={{
                        fontWeight: '700',
                        fontSize: 12,
                        color: reviewSubjectId === sub.id ? '#fff' : theme.colors.text,
                      }}
                    >
                      {sub.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Due Date & Time */}
            <DateField
              theme={theme}
              label="Due Date & Time (Resolved by AI)"
              value={reviewDue}
              onChange={setReviewDue}
            />

            <Input
              theme={theme}
              label="Notes"
              value={reviewNotes}
              onChangeText={setReviewNotes}
              placeholder="Additional details or instructions"
              multiline
            />

            {/* Campus Reminder Toggle */}
            <Pressable
              onPress={() => setReviewCampusReminder(!reviewCampusReminder)}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingVertical: 8,
              }}
            >
              <Text style={{ fontWeight: '700', color: theme.colors.text }}>
                Remind me when I reach campus
              </Text>
              <View
                style={{
                  width: 42,
                  height: 24,
                  borderRadius: 12,
                  padding: 3,
                  alignItems: reviewCampusReminder ? 'flex-end' : 'flex-start',
                  backgroundColor: reviewCampusReminder ? theme.colors.accent : theme.colors.border,
                }}
              >
                <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' }} />
              </View>
            </Pressable>

            <View style={{ gap: 10, marginTop: 8 }}>
              <Button theme={theme} label="Confirm & Save Task" onPress={() => void confirmAndSaveVoiceTask()} />
              <Button theme={theme} label="Cancel" variant="secondary" onPress={() => setReviewOpen(false)} />
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* MANUAL ADD TASK SHEET */}
      <Sheet theme={theme} visible={open} onClose={() => setOpen(false)} title="Add a task">
        <View style={{ gap: 11 }}>
          <Input theme={theme} label="Title" value={title} onChangeText={setTitle} placeholder="What needs doing?" />
          <VoiceInputButton
            theme={theme}
            label="Speak task title"
            onTranscript={(text) => setTitle((current) => `${current}${current ? ' ' : ''}${text}`)}
          />
          <Choice label="Type" values={types} selected={type} set={(value) => setType(value as TaskType)} theme={theme} />
          <Choice label="Priority" values={priorities} selected={priority} set={(value) => setPriority(value as Priority)} theme={theme} />
          <DateField theme={theme} label="Due date & time (optional)" value={due} onChange={setDue} />
          <Input theme={theme} label="Notes" value={notes} onChangeText={setNotes} placeholder="Requirements or next step" multiline />
          <Pressable
            onPress={() => setCampusReminder(!campusReminder)}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingVertical: 8,
            }}
          >
            <Text style={{ fontWeight: '700', color: theme.colors.text }}>Remind me when I reach campus</Text>
            <View
              style={{
                width: 42,
                height: 24,
                borderRadius: 12,
                padding: 3,
                alignItems: campusReminder ? 'flex-end' : 'flex-start',
                backgroundColor: campusReminder ? theme.colors.accent : theme.colors.border,
              }}
            >
              <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' }} />
            </View>
          </Pressable>
          <Text style={{ fontWeight: '700', color: theme.colors.text }}>Course (optional)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {subjects.map((subject) => (
              <Pressable
                key={subject.id}
                onPress={() => setSubjectId(subject.id)}
                style={{
                  padding: 8,
                  borderRadius: 9,
                  backgroundColor: subjectId === subject.id ? subject.color : theme.colors.surfaceSoft,
                }}
              >
                <Text
                  style={{
                    fontWeight: '700',
                    fontSize: 12,
                    color: subjectId === subject.id ? '#fff' : theme.colors.text,
                  }}
                >
                  {subject.name}
                </Text>
              </Pressable>
            ))}
          </View>
          <Button theme={theme} label="Save task" onPress={() => void create()} />
        </View>
      </Sheet>
    </Screen>
  );
}

function Choice({
  label,
  values,
  selected,
  set,
  theme,
}: {
  label: string;
  values: readonly string[];
  selected: string;
  set: (value: string) => void;
  theme: AppTheme;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontWeight: '700', color: theme.colors.text }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
        {values.map((value) => (
          <Pressable
            key={value}
            onPress={() => set(value)}
            style={{
              padding: 8,
              borderRadius: 9,
              backgroundColor: selected === value ? theme.colors.accent : theme.colors.surfaceSoft,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '800', color: selected === value ? '#fff' : theme.colors.text }}>
              {value}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
