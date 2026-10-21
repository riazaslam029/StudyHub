import React, { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react-native';
import { generateMockQuiz, MockQuestion } from '../ai';
import { Button, Card, Empty, Heading, Input, Screen } from '../components';
import { AppTheme } from '../theme';

export function MockQuizScreen({ theme, navigation }: { theme: AppTheme; navigation: any }) {
  const [topic, setTopic] = useState('');
  const [questions, setQuestions] = useState<MockQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (!topic.trim()) return Alert.alert('Enter a topic first');
    setBusy(true);
    try {
      const result = await generateMockQuiz(topic);
      setQuestions(result.data);
      setIndex(0);
      setSelected(null);
      setScore(0);
    } catch (e) {
      Alert.alert(
        'AI quiz unavailable',
        e instanceof Error ? e.message : 'AI is temporarily unavailable, please try again in a bit.'
      );
    } finally {
      setBusy(false);
    }
  };

  const choose = (answer: number) => {
    if (selected !== null) return;
    setSelected(answer);
    if (answer === questions[index]?.correct_index) {
      setScore(score + 1);
    }
  };

  const next = () => {
    setIndex(index + 1);
    setSelected(null);
  };

  const finished = questions.length > 0 && index >= questions.length;

  if (finished) {
    return (
      <Screen theme={theme}>
        <Pressable onPress={() => navigation.goBack()} style={{ flexDirection: 'row', gap: 7, alignItems: 'center', marginBottom: 12 }}>
          <ArrowLeft color={theme.colors.accent} size={20} />
          <Text style={{ color: theme.colors.accent, fontWeight: '800' }}>Back to Exam prep</Text>
        </Pressable>

        <Heading theme={theme} eyebrow="via Google Gemini">
          Quiz complete
        </Heading>

        <Card theme={theme} style={{ alignItems: 'center', paddingVertical: 24 }}>
          <Text style={{ fontSize: 56, fontWeight: '800', color: score >= 7 ? theme.colors.positive : theme.colors.accent }}>
            {score}/10
          </Text>
          <Text style={{ color: theme.colors.muted, marginTop: 4, fontWeight: '600' }}>Topic: {topic}</Text>
          <Text style={{ color: theme.colors.text, marginTop: 8, fontSize: 13, textAlign: 'center' }}>
            {score >= 8
              ? 'Outstanding grasp of the concepts! Ready for the real exam.'
              : score >= 5
              ? 'Good effort! Review missed questions and try another run.'
              : 'Keep practicing! Generate a new set to solidify your understanding.'}
          </Text>
        </Card>

        <Button
          theme={theme}
          label="Retake this quiz"
          onPress={() => {
            setIndex(0);
            setScore(0);
            setSelected(null);
          }}
        />
        <Button theme={theme} label="Generate new set" variant="secondary" onPress={() => void generate()} />
        <Button theme={theme} label="Done & exit" variant="quiet" onPress={() => navigation.goBack()} />
      </Screen>
    );
  }

  const q = questions[index];

  return (
    <Screen theme={theme}>
      <Pressable onPress={() => navigation.goBack()} style={{ flexDirection: 'row', gap: 7, alignItems: 'center' }}>
        <ArrowLeft color={theme.colors.accent} size={20} />
        <Text style={{ color: theme.colors.accent, fontWeight: '800' }}>Exam prep</Text>
      </Pressable>

      <Heading theme={theme} eyebrow={q ? `Question ${index + 1} of 10 · via Google Gemini` : 'AI practice'}>
        Mock quiz
      </Heading>

      {!q ? (
        <>
          <Input
            theme={theme}
            label="Topic or chapter"
            value={topic}
            onChangeText={setTopic}
            multiline
            placeholder="e.g. Database normalization up to BCNF, Cache coherence protocols"
          />
          <Button
            theme={theme}
            label={busy ? 'Generating 10 questions with Gemini…' : 'Generate mock quiz'}
            disabled={busy}
            onPress={() => void generate()}
          />
          <Empty
            theme={theme}
            title="Practice without pressure"
            detail="AI generates tailored university-level multiple choice questions with explanations."
          />
        </>
      ) : (
        <>
          <Card theme={theme}>
            <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '800', lineHeight: 26 }}>
              {q.question}
            </Text>
          </Card>

          <View style={{ gap: 8 }}>
            {q.options.map((option, i) => {
              const answered = selected !== null;
              const correct = i === q.correct_index;
              const chosen = i === selected;
              const bg = answered && correct ? theme.colors.positive : answered && chosen ? theme.colors.danger : theme.colors.surface;

              return (
                <Pressable
                  key={i}
                  onPress={() => choose(i)}
                  style={{
                    padding: 15,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: answered && correct ? theme.colors.positive : chosen ? theme.colors.danger : theme.colors.border,
                    backgroundColor: bg,
                    flexDirection: 'row',
                    gap: 10,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: answered && (correct || chosen) ? '#fff' : theme.colors.text, fontWeight: '800' }}>
                    {String.fromCharCode(65 + i)}.
                  </Text>
                  <Text style={{ color: answered && (correct || chosen) ? '#fff' : theme.colors.text, flex: 1 }}>
                    {option}
                  </Text>
                  {answered && correct ? (
                    <CheckCircle2 color="#fff" size={18} />
                  ) : answered && chosen ? (
                    <XCircle color="#fff" size={18} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          {selected !== null ? (
            <Button
              theme={theme}
              label={index === 9 ? 'See final score' : 'Next question'}
              onPress={next}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}
