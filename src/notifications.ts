import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getSetting, getStudyPlan, markAttendance, setSetting } from './db';
import { Slot, Task } from './types';

const channelId = 'study-reminders';
const attendanceCategory = 'attendance-check';
const snoozeMinutes = 15;
export const ATTEND_YES = 'ATTEND_YES';
export const ATTEND_NO = 'ATTEND_NO';
export const ATTEND_CANCELLED = 'ATTEND_CANCELLED';
export const ATTEND_SNOOZE = 'ATTEND_SNOOZE';

export type ReminderPreferences = {
  classLeadMinutes: number;
  deadlineOneDay: boolean;
  deadlineThreeHours: boolean;
  attendancePrompts: boolean;
  studyPlanReminder: boolean;
  weeklyDigest: boolean;
  weeklyDigestHour: number;
};

const defaults: ReminderPreferences = {
  classLeadMinutes: 5,
  deadlineOneDay: true,
  deadlineThreeHours: true,
  attendancePrompts: true,
  studyPlanReminder: true,
  weeklyDigest: true,
  weeklyDigestHour: 18,
};

type NotificationType = 'class' | 'task' | 'attendance-action' | 'attendance-snooze' | 'study-plan' | 'weekly-digest' | 'campus';
type AttendanceData = { type: 'attendance-action' | 'attendance-snooze'; slotId: number; subjectId: number; occurrenceDate?: string };

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

export async function configureNotifications() {
  try {
    const permissions = await Notifications.getPermissionsAsync();
    if (!permissions.granted) {
      const requested = await Notifications.requestPermissionsAsync();
      if (!requested.granted) return false;
    }
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(channelId, {
        name: 'Study reminders',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 150, 250],
      });
    }
    await Notifications.setNotificationCategoryAsync(attendanceCategory, [
      { identifier: ATTEND_YES, buttonTitle: 'Yes' },
      { identifier: ATTEND_NO, buttonTitle: 'No' },
      { identifier: ATTEND_SNOOZE, buttonTitle: `Remind in ${snoozeMinutes} min` },
      { identifier: ATTEND_CANCELLED, buttonTitle: 'Cancelled' },
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function getReminderPreferences(): Promise<ReminderPreferences> {
  const raw = await getSetting('notification_preferences');
  if (!raw) return defaults;
  try {
    return { ...defaults, ...JSON.parse(raw) as Partial<ReminderPreferences> };
  } catch {
    return defaults;
  }
}

export async function setReminderPreferences(preferences: ReminderPreferences) {
  await setSetting('notification_preferences', JSON.stringify(preferences));
}

const parseTime = (value: string) => {
  const parts = value.split(':');
  return { hours: Number(parts[0] ?? 0), minutes: Number(parts[1] ?? 0) };
};

const localDate = (value = new Date()) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

async function cancelByType(type: NotificationType) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(scheduled.filter((notification) => notification.content.data?.type === type).map((notification) => Notifications.cancelScheduledNotificationAsync(notification.identifier)));
}

async function cancelAttendanceSnoozes(slotId: number) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(scheduled
    .filter((notification) => notification.content.data?.type === 'attendance-snooze' && notification.content.data?.slotId === slotId)
    .map((notification) => Notifications.cancelScheduledNotificationAsync(notification.identifier)));
}

async function scheduleClassReminder(slot: Slot, lead: number) {
  const { hours, minutes } = parseTime(slot.start_time);
  let total = hours * 60 + minutes - lead;
  const day = total < 0 ? (slot.day_of_week + 6) % 7 : slot.day_of_week;
  total = (total + 1440) % 1440;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Class in ${lead} minutes`,
      body: `${slot.subject_name ?? 'StudyHub'} · ${slot.room || 'Location not set'}`,
      sound: 'default',
      data: { type: 'class', slotId: slot.id },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: day + 1, hour: Math.floor(total / 60), minute: total % 60, channelId },
  });
}

export async function rescheduleClassReminder(slot: Slot, lead?: number) {
  if (!await configureNotifications()) return false;
  await scheduleClassReminder(slot, lead ?? (await getReminderPreferences()).classLeadMinutes);
  return true;
}

export async function rescheduleAllClassReminders(slots: Slot[], preferences?: ReminderPreferences) {
  const prefs = preferences ?? await getReminderPreferences();
  if (!await configureNotifications()) return false;
  await cancelByType('class');
  await Promise.all(slots.map((slot) => scheduleClassReminder(slot, prefs.classLeadMinutes)));
  return true;
}

async function scheduleDue(task: Task, prefs: ReminderPreferences) {
  if (!task.due_at || task.status === 'done') return;
  const due = new Date(task.due_at).getTime();
  const entries = [[prefs.deadlineOneDay, 86400000, 'Tomorrow'], [prefs.deadlineThreeHours, 10800000, 'In 3 hours']] as const;
  for (const [enabled, offset, label] of entries) {
    const date = new Date(due - offset);
    if (enabled && date.getTime() > Date.now()) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `${label}: ${task.title}`,
          body: `${task.type.charAt(0).toUpperCase()}${task.type.slice(1)} deadline in StudyHub`,
          sound: 'default',
          data: { type: 'task', taskId: task.id },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId },
      });
    }
  }
}

export async function scheduleDueReminders(task: Task, preferences?: ReminderPreferences) {
  const prefs = preferences ?? await getReminderPreferences();
  if (!await configureNotifications()) return false;
  await scheduleDue(task, prefs);
  return true;
}

export async function rescheduleAllDueReminders(tasks: Task[], preferences?: ReminderPreferences) {
  const prefs = preferences ?? await getReminderPreferences();
  if (!await configureNotifications()) return false;
  await cancelByType('task');
  await Promise.all(tasks.map((task) => scheduleDue(task, prefs)));
  return true;
}

async function scheduleAttendancePrompt(slot: Slot) {
  const { hours, minutes } = parseTime(slot.end_time);
  let total = hours * 60 + minutes + 5;
  let day = slot.day_of_week;
  if (total >= 1440) {
    total -= 1440;
    day = (day + 1) % 7;
  }
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Did you attend ${slot.subject_name ?? 'class'}?`,
      body: 'Mark attendance without opening StudyHub.',
      sound: 'default',
      categoryIdentifier: attendanceCategory,
      data: { type: 'attendance-action', slotId: slot.id, subjectId: slot.subject_id },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: day + 1, hour: Math.floor(total / 60), minute: total % 60, channelId },
  });
}

export async function rescheduleAttendancePrompts(slots: Slot[], preferences?: ReminderPreferences) {
  const prefs = preferences ?? await getReminderPreferences();
  if (!prefs.attendancePrompts || !await configureNotifications()) return false;
  await cancelByType('attendance-action');
  await Promise.all(slots.map(scheduleAttendancePrompt));
  return true;
}

async function scheduleAttendanceSnooze(data: AttendanceData, occurrenceDate: string) {
  await cancelAttendanceSnoozes(data.slotId);
  const date = new Date(Date.now() + snoozeMinutes * 60 * 1000);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Attendance check',
      body: 'Did you attend this class?',
      sound: 'default',
      categoryIdentifier: attendanceCategory,
      data: { type: 'attendance-snooze', slotId: data.slotId, subjectId: data.subjectId, occurrenceDate },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId },
  });
}

export function registerNotificationActions(onWeeklyOverview?: () => void) {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    void (async () => {
      try {
        const rawData = response.notification.request.content.data as Record<string, unknown>;
        if ((rawData.type === 'attendance-action' || rawData.type === 'attendance-snooze') && typeof rawData.subjectId === 'number' && typeof rawData.slotId === 'number') {
          const data = rawData as AttendanceData;
          const occurrenceDate = data.occurrenceDate ?? localDate(new Date(response.notification.date));
          if (response.actionIdentifier === ATTEND_SNOOZE) {
            await scheduleAttendanceSnooze(data as AttendanceData, occurrenceDate);
            return;
          }
          const status = response.actionIdentifier === ATTEND_YES
            ? 'present'
            : response.actionIdentifier === ATTEND_NO
              ? 'absent'
              : response.actionIdentifier === ATTEND_CANCELLED
                ? 'cancelled'
                : null;
          if (status) {
            await cancelAttendanceSnoozes(data.slotId);
            await markAttendance(occurrenceDate, data.subjectId, data.slotId, status);
          }
        }
        if (rawData.type === 'weekly-digest') onWeeklyOverview?.();
      } catch {
        // A stale notification can reference deleted local data; ignore it rather than crashing the app.
      }
    })();
  });
}

export async function rescheduleStudyPlanReminders(preferences?: ReminderPreferences) {
  const prefs = preferences ?? await getReminderPreferences();
  if (!prefs.studyPlanReminder || !await configureNotifications()) return false;
  await cancelByType('study-plan');
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    date.setHours(8, 0, 0, 0);
    if (date.getTime() <= Date.now()) continue;
    const key = localDate(date);
    const items = await getStudyPlan(key);
    if (items.length) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `${items.length} study ${items.length === 1 ? 'item' : 'items'} today`,
          body: items.slice(0, 3).map((item) => item.topic).join(' · '),
          data: { type: 'study-plan' },
          sound: 'default',
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId },
      });
    }
  }
  return true;
}

export async function rescheduleWeeklyDigest(preferences?: ReminderPreferences) {
  const prefs = preferences ?? await getReminderPreferences();
  if (!prefs.weeklyDigest || !await configureNotifications()) return false;
  await cancelByType('weekly-digest');
  const first = new Date();
  const days = (7 - first.getDay()) % 7 || 7;
  first.setDate(first.getDate() + days);
  first.setHours(Math.min(23, Math.max(0, prefs.weeklyDigestHour)), 0, 0, 0);
  for (let week = 0; week < 8; week++) {
    const date = new Date(first);
    date.setDate(date.getDate() + week * 7);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Your StudyHub week ahead',
        body: 'Review your upcoming deadlines, exams, and attendance.',
        data: { type: 'weekly-digest' },
        sound: 'default',
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId },
    });
  }
  return true;
}

export async function notifyCampusTasks(count: number) {
  if (!await configureNotifications()) return false;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${count} campus ${count === 1 ? 'task' : 'tasks'} waiting`,
      body: 'You are near campus. Open StudyHub to see what needs doing.',
      data: { type: 'campus' },
      sound: 'default',
    },
    trigger: null,
  });
  return true;
}
