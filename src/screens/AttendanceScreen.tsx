import React, { useCallback, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  AlertTriangle,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Edit3,
  History,
  Minus,
  Plus,
  Trash2,
  X,
} from 'lucide-react-native';
import { Button, Card, Empty, Heading, Input, Row, Screen, Sheet } from '../components';
import {
  deleteAttendanceRecord,
  getAttendanceHistory,
  getAttendanceSummaries,
  getSetting,
  getSubjects,
  getTodayAttendance,
  markAttendance,
  quickAdjustAttendance,
  recordManualAttendance,
  updateAttendanceRecordStatus,
} from '../db';
import { AppTheme } from '../theme';
import { AttendanceRecord, AttendanceStatus, AttendanceSummary, Subject, TodayAttendance } from '../types';

const formatDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function AttendanceScreen({ theme }: { theme: AppTheme }) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [todayClasses, setTodayClasses] = useState<TodayAttendance[]>([]);
  const [summaries, setSummaries] = useState<AttendanceSummary[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const [threshold, setThreshold] = useState(75);

  // Sheets and Modals
  const [showManualModal, setShowManualModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [filterSubjectId, setFilterSubjectId] = useState<number | null>(null);

  // Manual entry draft
  const [manualSubjectId, setManualSubjectId] = useState<number | null>(null);
  const [manualDate, setManualDate] = useState(formatDateKey(new Date()));
  const [manualStatus, setManualStatus] = useState<AttendanceStatus>('present');

  const dateString = formatDateKey(selectedDate);
  const isToday = formatDateKey(new Date()) === dateString;

  const refresh = useCallback(async () => {
    const dayOfWeek = selectedDate.getDay();
    const [classes, allSummaries, savedThreshold, allSubjects, recentHistory] = await Promise.all([
      getTodayAttendance(dayOfWeek, dateString),
      getAttendanceSummaries(),
      getSetting('attendance_threshold'),
      getSubjects(),
      getAttendanceHistory(filterSubjectId ?? undefined, undefined, 40),
    ]);
    setTodayClasses(classes);
    setSummaries(allSummaries);
    setThreshold(Number(savedThreshold) || 75);
    setSubjects(allSubjects);
    setHistory(recentHistory);
  }, [dateString, selectedDate, filterSubjectId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const changeDateBy = (days: number) => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + days);
    setSelectedDate(next);
  };

  const markSlot = async (subjectId: number, slotId: number, status: AttendanceStatus) => {
    await markAttendance(dateString, subjectId, slotId, status);
    await refresh();
  };

  const handleQuickAdjust = async (subjectId: number, status: AttendanceStatus) => {
    await quickAdjustAttendance(subjectId, status, 1);
    await refresh();
  };

  const handleSaveManual = async () => {
    if (!manualSubjectId) {
      Alert.alert('Please select a subject');
      return;
    }
    if (!manualDate.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(manualDate.trim())) {
      Alert.alert('Invalid Date', 'Please enter date in YYYY-MM-DD format');
      return;
    }
    await recordManualAttendance(manualDate.trim(), manualSubjectId, manualStatus);
    setShowManualModal(false);
    await refresh();
    Alert.alert('Attendance saved', 'Manual attendance record has been recorded.');
  };

  const handleToggleHistoryStatus = async (record: AttendanceRecord) => {
    const nextStatus: AttendanceStatus =
      record.status === 'present' ? 'absent' : record.status === 'absent' ? 'cancelled' : 'present';
    await updateAttendanceRecordStatus(record.id, nextStatus);
    await refresh();
  };

  const handleDeleteHistory = async (id: number) => {
    Alert.alert('Delete record?', 'Are you sure you want to remove this attendance log?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteAttendanceRecord(id);
          await refresh();
        },
      },
    ]);
  };

  return (
    <Screen theme={theme}>
      <Heading
        theme={theme}
        eyebrow={selectedDate.toLocaleDateString([], {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
        })}
      >
        Attendance
      </Heading>

      {/* DATE SELECTOR & NAVIGATION */}
      <Card theme={theme}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable
            onPress={() => changeDateBy(-1)}
            style={{ padding: 8, borderRadius: 10, backgroundColor: theme.colors.surfaceSoft }}
          >
            <ChevronLeft size={20} color={theme.colors.text} />
          </Pressable>

          <Pressable
            onPress={() => setSelectedDate(new Date())}
            style={{ alignItems: 'center', gap: 2 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Calendar size={16} color={theme.colors.accent} />
              <Text style={{ fontWeight: '800', color: theme.colors.text, fontSize: 16 }}>
                {isToday ? 'Today' : selectedDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}
              </Text>
            </View>
            <Text style={{ fontSize: 12, color: theme.colors.muted }}>
              {selectedDate.toLocaleDateString([], { weekday: 'long' })}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => changeDateBy(1)}
            style={{ padding: 8, borderRadius: 10, backgroundColor: theme.colors.surfaceSoft }}
          >
            <ChevronRight size={20} color={theme.colors.text} />
          </Pressable>
        </View>

        {/* Action buttons */}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          <View style={{ flex: 1 }}>
            <Button
              theme={theme}
              label="+ Manual Log"
              onPress={() => {
                setManualDate(dateString);
                if (subjects.length > 0 && !manualSubjectId && subjects[0]) {
                  setManualSubjectId(subjects[0].id);
                }
                setShowManualModal(true);
              }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              theme={theme}
              label="Edit / History"
              variant="secondary"
              onPress={() => setShowHistoryModal(true)}
            />
          </View>
        </View>
      </Card>

      {/* CLASSES FOR SELECTED DAY */}
      <View style={{ gap: 10 }}>
        <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 17 }}>
          {isToday ? "Today's scheduled classes" : `Classes for ${selectedDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`}
        </Text>

        {todayClasses.length > 0 ? (
          todayClasses.map((item) => (
            <Card key={item.timetable_slot_id} theme={theme}>
              <Row
                theme={theme}
                title={item.name}
                subtitle={`${item.start_time}–${item.end_time}${item.room ? ` · Room ${item.room}` : ''}${
                  item.attendance_status ? ` · Marked: ${item.attendance_status.toUpperCase()}` : ' · Not marked'
                }`}
              />
              <View style={{ flexDirection: 'row', gap: 7 }}>
                <StatusButton
                  theme={theme}
                  label="Present"
                  selected={item.attendance_status === 'present'}
                  color={theme.colors.positive}
                  icon={<Check size={15} color={item.attendance_status === 'present' ? '#fff' : theme.colors.positive} />}
                  onPress={() => void markSlot(item.id, item.timetable_slot_id, 'present')}
                />
                <StatusButton
                  theme={theme}
                  label="Absent"
                  selected={item.attendance_status === 'absent'}
                  color={theme.colors.danger}
                  icon={<X size={15} color={item.attendance_status === 'absent' ? '#fff' : theme.colors.danger} />}
                  onPress={() => void markSlot(item.id, item.timetable_slot_id, 'absent')}
                />
                <StatusButton
                  theme={theme}
                  label="Cancelled"
                  selected={item.attendance_status === 'cancelled'}
                  color={theme.colors.muted}
                  icon={<Minus size={15} color={item.attendance_status === 'cancelled' ? '#fff' : theme.colors.muted} />}
                  onPress={() => void markSlot(item.id, item.timetable_slot_id, 'cancelled')}
                />
              </View>
            </Card>
          ))
        ) : (
          <Empty
            theme={theme}
            title="No classes scheduled on this day"
            detail="You can still add or edit attendance using the '+ Manual Log' button above."
          />
        )}
      </View>

      {/* OVERALL SUBJECT BREAKDOWN & QUICK ADJUST */}
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 17 }}>Subject Breakdown & Target</Text>
          <Text style={{ color: theme.colors.muted, fontSize: 13 }}>Target: {threshold}%</Text>
        </View>

        {summaries.map((item) => {
          const isLow = item.percentage !== null && item.percentage < threshold;
          const total = item.present_count + item.absent_count;

          // Projection calculation
          let projectionText = '';
          if (total > 0 && item.percentage !== null) {
            if (isLow) {
              const needed = Math.max(1, Math.ceil((threshold * total - 100 * item.present_count) / (100 - threshold)));
              projectionText = `⚠️ Need to attend next ${needed} classes consecutively to reach ${threshold}%.`;
            } else {
              const canMiss = Math.floor((100 * item.present_count - threshold * total) / threshold);
              projectionText =
                canMiss > 0
                  ? `✅ Safe to miss next ${canMiss} ${canMiss === 1 ? 'class' : 'classes'} and stay above ${threshold}%.`
                  : `🎯 Right at ${threshold}%. Do not miss your next class.`;
            }
          }

          return (
            <Card
              key={item.id}
              theme={theme}
              style={isLow ? { borderColor: theme.colors.danger, borderWidth: 1.5 } : undefined}
            >
              <Row
                theme={theme}
                title={item.name}
                subtitle={
                  item.total_count
                    ? `${item.present_count} present · ${item.absent_count} absent · ${item.cancelled_count} cancelled`
                    : 'No classes logged yet'
                }
                right={
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Text
                      style={{
                        fontSize: 22,
                        fontWeight: '800',
                        color: isLow
                          ? theme.colors.danger
                          : item.percentage === null
                            ? theme.colors.muted
                            : theme.colors.positive,
                      }}
                    >
                      {item.percentage === null ? '—' : `${item.percentage}%`}
                    </Text>
                    {isLow && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                        <AlertTriangle size={12} color={theme.colors.danger} />
                        <Text style={{ fontSize: 11, color: theme.colors.danger, fontWeight: '700' }}>LOW</Text>
                      </View>
                    )}
                  </View>
                }
              />

              {/* Projection tip */}
              {projectionText ? (
                <Text style={{ fontSize: 12, color: isLow ? theme.colors.danger : theme.colors.muted, lineHeight: 16 }}>
                  {projectionText}
                </Text>
              ) : null}

              {/* Quick Manual Adjust Buttons */}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <Pressable
                  onPress={() => void handleQuickAdjust(item.id, 'present')}
                  style={{
                    flex: 1,
                    backgroundColor: theme.colors.surfaceSoft,
                    borderRadius: 10,
                    paddingVertical: 8,
                    alignItems: 'center',
                    flexDirection: 'row',
                    justifyContent: 'center',
                    gap: 6,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                  }}
                >
                  <Plus size={14} color={theme.colors.positive} />
                  <Text style={{ color: theme.colors.positive, fontWeight: '700', fontSize: 12 }}>+1 Present</Text>
                </Pressable>

                <Pressable
                  onPress={() => void handleQuickAdjust(item.id, 'absent')}
                  style={{
                    flex: 1,
                    backgroundColor: theme.colors.surfaceSoft,
                    borderRadius: 10,
                    paddingVertical: 8,
                    alignItems: 'center',
                    flexDirection: 'row',
                    justifyContent: 'center',
                    gap: 6,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                  }}
                >
                  <Plus size={14} color={theme.colors.danger} />
                  <Text style={{ color: theme.colors.danger, fontWeight: '700', fontSize: 12 }}>+1 Absent</Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    setFilterSubjectId(item.id);
                    setShowHistoryModal(true);
                  }}
                  style={{
                    backgroundColor: theme.colors.surfaceSoft,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    justifyContent: 'center',
                    alignItems: 'center',
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                  }}
                >
                  <History size={16} color={theme.colors.accent} />
                </Pressable>
              </View>
            </Card>
          );
        })}
      </View>

      {/* MODAL: MANUAL ENTRY */}
      <Sheet theme={theme} visible={showManualModal} onClose={() => setShowManualModal(false)} title="Manual Attendance">
        <View style={{ gap: 14 }}>
          <Text style={{ fontWeight: '700', color: theme.colors.text }}>Select Subject</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {subjects.map((sub) => {
              const isSelected = manualSubjectId === sub.id;
              return (
                <Pressable
                  key={sub.id}
                  onPress={() => setManualSubjectId(sub.id)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 10,
                    backgroundColor: isSelected ? theme.colors.accent : theme.colors.surfaceSoft,
                    borderWidth: 1,
                    borderColor: isSelected ? theme.colors.accent : theme.colors.border,
                  }}
                >
                  <Text style={{ color: isSelected ? '#fff' : theme.colors.text, fontWeight: '700', fontSize: 13 }}>
                    {sub.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Input
            theme={theme}
            label="Date (YYYY-MM-DD)"
            value={manualDate}
            onChangeText={setManualDate}
            placeholder="2026-09-29"
          />

          <Text style={{ fontWeight: '700', color: theme.colors.text }}>Attendance Status</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['present', 'absent', 'cancelled'] as AttendanceStatus[]).map((status) => {
              const isSelected = manualStatus === status;
              const color =
                status === 'present'
                  ? theme.colors.positive
                  : status === 'absent'
                    ? theme.colors.danger
                    : theme.colors.muted;
              return (
                <Pressable
                  key={status}
                  onPress={() => setManualStatus(status)}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 10,
                    backgroundColor: isSelected ? color : theme.colors.surfaceSoft,
                    alignItems: 'center',
                    borderWidth: 1,
                    borderColor: isSelected ? color : theme.colors.border,
                  }}
                >
                  <Text style={{ color: isSelected ? '#fff' : theme.colors.text, fontWeight: '800', fontSize: 12 }}>
                    {status.toUpperCase()}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Button theme={theme} label="Save Attendance" onPress={() => void handleSaveManual()} />
        </View>
      </Sheet>

      {/* MODAL: EDIT / HISTORY */}
      <Sheet
        theme={theme}
        visible={showHistoryModal}
        onClose={() => {
          setShowHistoryModal(false);
          setFilterSubjectId(null);
        }}
        title="Attendance Records & History"
      >
        <View style={{ gap: 12, flex: 1 }}>
          {/* Subject Filter chips */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Pressable
              onPress={() => setFilterSubjectId(null)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 8,
                backgroundColor: filterSubjectId === null ? theme.colors.accent : theme.colors.surfaceSoft,
              }}
            >
              <Text style={{ color: filterSubjectId === null ? '#fff' : theme.colors.text, fontWeight: '700', fontSize: 12 }}>
                All
              </Text>
            </Pressable>
            {subjects.map((sub) => (
              <Pressable
                key={sub.id}
                onPress={() => setFilterSubjectId(sub.id)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 8,
                  backgroundColor: filterSubjectId === sub.id ? theme.colors.accent : theme.colors.surfaceSoft,
                }}
              >
                <Text style={{ color: filterSubjectId === sub.id ? '#fff' : theme.colors.text, fontWeight: '700', fontSize: 12 }}>
                  {sub.name}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={{ fontSize: 12, color: theme.colors.muted }}>
            Tap status badge to toggle (Present ⇄ Absent ⇄ Cancelled). Tap trash to delete.
          </Text>

          <View style={{ maxHeight: 360 }}>
            {history.length > 0 ? (
              history.map((record) => {
                const badgeColor =
                  record.status === 'present'
                    ? theme.colors.positive
                    : record.status === 'absent'
                      ? theme.colors.danger
                      : theme.colors.muted;

                return (
                  <View
                    key={record.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 8,
                      borderBottomWidth: 1,
                      borderBottomColor: theme.colors.border,
                    }}
                  >
                    <View style={{ gap: 2, flex: 1 }}>
                      <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 14 }}>
                        {record.subject_name || 'Subject'}
                      </Text>
                      <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                        {record.date} {record.start_time ? `· ${record.start_time}` : '· Manual log'}
                      </Text>
                    </View>

                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Pressable
                        onPress={() => void handleToggleHistoryStatus(record)}
                        style={{
                          backgroundColor: badgeColor,
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                          borderRadius: 8,
                        }}
                      >
                        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 11 }}>
                          {record.status.toUpperCase()}
                        </Text>
                      </Pressable>

                      <Pressable onPress={() => void handleDeleteHistory(record.id)} style={{ padding: 6 }}>
                        <Trash2 size={16} color={theme.colors.danger} />
                      </Pressable>
                    </View>
                  </View>
                );
              })
            ) : (
              <Empty
                theme={theme}
                title="No attendance records"
                detail="Records will appear here as you log classes."
              />
            )}
          </View>
        </View>
      </Sheet>
    </Screen>
  );
}

function StatusButton({
  theme,
  label,
  selected,
  color,
  icon,
  onPress,
}: {
  theme: AppTheme;
  label: string;
  selected: boolean;
  color: string;
  icon: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 40,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 5,
        backgroundColor: selected ? color : theme.colors.surfaceSoft,
        borderWidth: 1,
        borderColor: selected ? color : theme.colors.border,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <>{icon}</>
      <Text style={{ color: selected ? '#fff' : theme.colors.text, fontWeight: '800', fontSize: 11 }}>{label}</Text>
    </Pressable>
  );
}
