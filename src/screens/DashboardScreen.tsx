import React, { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { CalendarDays, CheckCircle2, ClipboardList, Mic, Plus } from 'lucide-react-native';
import { Card, Empty, Heading, Row, Screen, Sheet } from '../components';
import { getSlots, getTasks, getSetting } from '../db';
import { AppTheme } from '../theme';
import { Slot, Task } from '../types';

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function DashboardScreen({ theme, navigation }: { theme: AppTheme; navigation: any }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [name, setName] = useState('');
  const [quick, setQuick] = useState(false);
  const today = new Date();

  const refresh = useCallback(async () => {
    const day = new Date().getDay();
    setSlots(await getSlots(day));
    setTasks(await getTasks({ today: true }));
    setName((await getSetting('student_name')) ?? 'there');
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const next = slots.find((s) => {
    const parts = s.start_time.split(':').map(Number);
    const h = parts[0] ?? 0;
    const m = parts[1] ?? 0;
    return h * 60 + m > today.getHours() * 60 + today.getMinutes();
  });

  return (
    <Screen theme={theme}>
      <Heading theme={theme} eyebrow={dayNames[today.getDay()]}>
        Good day, {name}
      </Heading>
      <Card theme={theme} style={{ backgroundColor: theme.colors.accent, borderColor: theme.colors.accent }}>
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13, opacity: 0.85 }}>NEXT UP</Text>
        <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 3 }}>
          {next ? next.subject_name : 'Your schedule is clear'}
        </Text>
        <Text style={{ color: '#fff', marginTop: 4, opacity: 0.9 }}>
          {next
            ? `${next.start_time}–${next.end_time}${next.room ? ` · ${next.room}` : ''}`
            : 'Use the timetable to plan your week.'}
        </Text>
      </Card>

      <View style={{ gap: 10 }}>
        <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 17 }}>Today’s timeline</Text>
        {slots.length ? (
          <Card theme={theme}>
            {slots.map((slot, i) => (
              <View key={slot.id} style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ alignItems: 'center', width: 43 }}>
                  <Text style={{ color: theme.colors.muted, fontSize: 11, fontWeight: '700' }}>
                    {slot.start_time}
                  </Text>
                  <View
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 9,
                      marginVertical: 6,
                      backgroundColor: slot.subject_color,
                    }}
                  />
                  {i < slots.length - 1 && (
                    <View style={{ width: 1, height: 30, backgroundColor: theme.colors.border }} />
                  )}
                </View>
                <View style={{ flex: 1, paddingBottom: i < slots.length - 1 ? 13 : 0 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: '800' }}>{slot.subject_name}</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                    {slot.end_time}
                    {slot.room ? ` · ${slot.room}` : ''}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        ) : (
          <Empty theme={theme} title="No classes today" detail="Enjoy the breathing room, or build your timetable." />
        )}
      </View>

      <View style={{ gap: 7 }}>
        <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 17 }}>Due today</Text>
        <Card theme={theme}>
          {tasks.length ? (
            tasks
              .slice(0, 3)
              .map((t) => (
                <Row
                  key={t.id}
                  theme={theme}
                  title={t.title}
                  subtitle={`${t.type} · ${t.subject_name ?? 'Personal'}`}
                  right={
                    <CheckCircle2
                      color={t.status === 'done' ? theme.colors.positive : theme.colors.muted}
                      size={19}
                    />
                  }
                  onPress={() => navigation.navigate('Planner', { screen: 'Tasks' })}
                />
              ))
          ) : (
            <Text style={{ color: theme.colors.muted }}>Nothing urgent today. Nice work.</Text>
          )}
        </Card>
      </View>

      <Pressable
        onPress={() => setQuick(true)}
        style={{
          position: 'absolute',
          right: 22,
          bottom: 24,
          width: 58,
          height: 58,
          borderRadius: 29,
          backgroundColor: theme.colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
          elevation: 5,
        }}
      >
        <Plus color="#fff" size={27} />
      </Pressable>

      <Sheet visible={quick} onClose={() => setQuick(false)} title="Quick add" theme={theme}>
        <View style={{ gap: 10 }}>
          <Pressable
            onPress={() => {
              setQuick(false);
              navigation.navigate('Planner', { screen: 'Tasks', params: { voiceTask: true } });
            }}
          >
            <Row
              theme={theme}
              title="Voice note to task (AI)"
              subtitle="Speak a task naturally and let AI structure it"
              right={<Mic color={theme.colors.accent} />}
            />
          </Pressable>
          <Pressable
            onPress={() => {
              setQuick(false);
              navigation.navigate('Planner', { screen: 'Tasks', params: { create: true } });
            }}
          >
            <Row
              theme={theme}
              title="New task"
              subtitle="Assignment, quiz, or personal to-do"
              right={<CheckCircle2 color={theme.colors.accent} />}
            />
          </Pressable>
          <Pressable
            onPress={() => {
              setQuick(false);
              navigation.navigate('Notes');
            }}
          >
            <Row
              theme={theme}
              title="New note"
              subtitle="Capture lecture blocks or attach files"
              right={<ClipboardList color={theme.colors.accent} />}
            />
          </Pressable>
          <Pressable
            onPress={() => {
              setQuick(false);
              navigation.navigate('Planner', { screen: 'Timetable' });
            }}
          >
            <Row
              theme={theme}
              title="Add class"
              subtitle="Put a class on your weekly timetable"
              right={<CalendarDays color={theme.colors.accent} />}
            />
          </Pressable>
        </View>
      </Sheet>
    </Screen>
  );
}
