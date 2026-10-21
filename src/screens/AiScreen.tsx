import React, { useCallback, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Sparkles } from 'lucide-react-native';
import { askStudyAssistant } from '../ai';
import { Button, Card, Empty, Heading, Input, Screen, Sheet } from '../components';
import { getSources, getSubjects, saveSource } from '../db';
import { AppTheme } from '../theme';
import { AiSource, Subject } from '../types';

export function AiScreen({ theme }: { theme: AppTheme }) {
  const [sources, setSources] = useState<AiSource[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [sourceText, setSourceText] = useState('');
  const [sourceSubject, setSourceSubject] = useState<number | undefined>();

  const refresh = useCallback(async () => {
    const [allSources, allSubjects] = await Promise.all([getSources(), getSubjects()]);
    setSources(allSources);
    setSubjects(allSubjects);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const ask = async () => {
    if (!question.trim()) return;
    setBusy(true);
    try {
      const source = sources[0]?.raw_text;
      const result = await askStudyAssistant(question, source);
      setAnswer(result.data);
    } catch (e) {
      Alert.alert('AI couldn’t answer', e instanceof Error ? e.message : 'Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!sourceSubject || !sourceText.trim()) {
      return Alert.alert('Missing details', 'Please choose a course and paste study content.');
    }
    await saveSource(sourceSubject, sourceText);
    setSourceText('');
    setOpen(false);
    void refresh();
  };

  return (
    <Screen theme={theme}>
      <Heading theme={theme} eyebrow="Grounded study help">
        AI workspace
      </Heading>

      <Card theme={theme} style={{ backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accentSoft }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Sparkles size={18} color={theme.colors.accent} />
          <Text style={{ fontWeight: '800', color: theme.colors.text }}>Notebook Q&A</Text>
        </View>
        <Text style={{ color: theme.colors.muted, fontSize: 13, lineHeight: 18 }}>
          Questions use your saved lecture notes and course material. Powered directly by Google Gemini AI with high-accuracy contextual understanding.
        </Text>
        <Button theme={theme} label="Add study source" variant="secondary" onPress={() => setOpen(true)} />
      </Card>

      <Input
        theme={theme}
        label="Ask a study question"
        value={question}
        onChangeText={setQuestion}
        placeholder="e.g. Explain the difference between optimistic and pessimistic concurrency control"
        multiline
      />

      <Button
        theme={theme}
        label={busy ? 'Consulting Gemini…' : 'Ask AI'}
        onPress={() => void ask()}
        disabled={busy || !question.trim()}
      />

      {answer ? (
        <Card theme={theme}>
          <Text style={{ fontWeight: '800', color: theme.colors.accent, fontSize: 12 }}>
            STUDYHUB AI · via Google Gemini
          </Text>
          <Text style={{ color: theme.colors.text, lineHeight: 22, marginTop: 4 }}>{answer}</Text>
        </Card>
      ) : (
        <Empty
          theme={theme}
          title="Ask for a clearer explanation"
          detail="Try summarizing a concept, generating a quiz, or asking about a pasted source."
        />
      )}

      <Sheet theme={theme} visible={open} onClose={() => setOpen(false)} title="Add a source">
        <View style={{ gap: 12 }}>
          <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
            Paste lecture notes, syllabi, or textbook content to ground the AI responses.
          </Text>
          <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
            {subjects.map((s) => (
              <Button
                key={s.id}
                theme={theme}
                label={s.name}
                variant={sourceSubject === s.id ? 'primary' : 'secondary'}
                onPress={() => setSourceSubject(s.id)}
              />
            ))}
          </View>
          <Input
            theme={theme}
            label="Source text"
            value={sourceText}
            onChangeText={setSourceText}
            placeholder="Paste your material here…"
            multiline
          />
          <Button theme={theme} label="Save source locally" onPress={() => void save()} />
        </View>
      </Sheet>
    </Screen>
  );
}
