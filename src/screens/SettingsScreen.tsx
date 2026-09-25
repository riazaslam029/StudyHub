import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Eye, EyeOff, KeyRound, MapPin, Trash2 } from 'lucide-react-native';
import {
  AIProvider,
  getAIKeyStatus,
  getApiKey,
  getGroqApiKey,
  getPrimaryProvider,
  setApiKey,
  setGroqApiKey,
  setPrimaryProvider,
  testGeminiConnection,
  testGroqConnection,
} from '../ai';
import { Button, Card, Heading, Input, Row, Screen } from '../components';
import {
  addSubject,
  deleteSubject,
  exportDatabase,
  getSetting,
  getSlots,
  getSubjects,
  getTasks,
  restoreDatabase,
  setSetting,
} from '../db';
import {
  geocodeCampusAddress,
  getCurrentCampusLocation,
  requestCampusLocationPermission,
} from '../location';
import {
  configureNotifications,
  getReminderPreferences,
  ReminderPreferences,
  rescheduleAllClassReminders,
  rescheduleAllDueReminders,
  rescheduleAttendancePrompts,
  rescheduleStudyPlanReminders,
  rescheduleWeeklyDigest,
  setReminderPreferences,
} from '../notifications';
import { useAppStore } from '../store';
import { AppTheme, palette } from '../theme';
import { Subject } from '../types';

export function SettingsScreen({ theme }: { theme: AppTheme }) {
  const [geminiKey, setGeminiKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [testingGemini, setTestingGemini] = useState(false);
  const [testingGroq, setTestingGroq] = useState(false);
  const [primary, setPrimary] = useState<AIProvider>('gemini');

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [newSubject, setNewSubject] = useState('');
  const [semester, setSemester] = useState('Comsats 5th Semester');
  const [attendanceThreshold, setAttendanceThreshold] = useState('75');

  // Campus location state
  const [campusSearch, setCampusSearch] = useState('');
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const [isLocatingCurrent, setIsLocatingCurrent] = useState(false);
  const [campusLat, setCampusLat] = useState('');
  const [campusLon, setCampusLon] = useState('');
  const [campusRadius, setCampusRadius] = useState('200');
  const [campusEnabled, setCampusEnabled] = useState(false);
  const [resolvedLocationName, setResolvedLocationName] = useState('');

  const [categories, setCategories] = useState('Food, Transport, Hostel/Mess, Other');
  const [preferences, setPreferences] = useState<ReminderPreferences>({
    classLeadMinutes: 5,
    deadlineOneDay: true,
    deadlineThreeHours: true,
    attendancePrompts: true,
    studyPlanReminder: true,
    weeklyDigest: true,
    weeklyDigestHour: 18,
  });

  const appTheme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  const refresh = useCallback(async () => {
    const [
      key,
      groq,
      provider,
      courses,
      savedSemester,
      prefs,
      threshold,
      lat,
      lon,
      radius,
      enabled,
      cats,
    ] = await Promise.all([
      getApiKey(),
      getGroqApiKey(),
      getPrimaryProvider(),
      getSubjects(),
      getSetting('semester'),
      getReminderPreferences(),
      getSetting('attendance_threshold'),
      getSetting('campus_latitude'),
      getSetting('campus_longitude'),
      getSetting('campus_radius'),
      getSetting('campus_location_enabled'),
      getSetting('expense_categories'),
    ]);

    console.log('[Settings] Loaded AI keys present -> Gemini:', !!key, 'Groq:', !!groq);
    console.log('[Settings] Loaded Campus -> Lat:', lat, 'Lon:', lon, 'Enabled:', enabled);

    setGeminiKey(key ?? '');
    setGroqKey(groq ?? '');
    setPrimary(provider);
    setSubjects(courses);
    setSemester(savedSemester ?? 'Comsats 5th Semester');
    setPreferences(prefs);
    setAttendanceThreshold(threshold ?? '75');
    setCampusLat(lat ?? '');
    setCampusLon(lon ?? '');
    setCampusRadius(radius ?? '200');
    setCampusEnabled(enabled === 'true');
    setCategories(cats ?? 'Food, Transport, Hostel/Mess, Other');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Save AI Settings
  const saveAI = async () => {
    try {
      await Promise.all([
        setApiKey(geminiKey),
        setGroqApiKey(groqKey),
        setPrimaryProvider(primary),
      ]);
      const status = await getAIKeyStatus();
      console.log('[Settings] AI keys successfully saved and verified. Status:', status);

      Alert.alert(
        'AI settings saved',
        status.gemini && status.groq
          ? `${primary === 'gemini' ? 'Gemini' : 'Groq'} is set as primary; the other will serve as automatic fallback.`
          : status.gemini
            ? 'Gemini key configured. Text and image AI will work.'
            : status.groq
              ? 'Groq key configured. Text AI will work; image import needs a Gemini key.'
              : 'Keys cleared. Add at least one API key to use AI features.'
      );
    } catch (error) {
      console.error('[Settings] Error saving AI keys:', error);
      Alert.alert(
        'Could not save AI keys',
        error instanceof Error ? error.message : 'Secure storage error. Please try again.'
      );
    }
  };

  // Test individual AI providers
  const handleTestGemini = async () => {
    setTestingGemini(true);
    try {
      const res = await testGeminiConnection(geminiKey);
      if (res.success) {
        Alert.alert('Gemini Connected Successfully', `Response from Gemini:\n\n${res.message}`);
      } else {
        Alert.alert('Gemini Connection Failed', res.message);
      }
    } catch (e) {
      Alert.alert('Gemini Test Error', e instanceof Error ? e.message : 'Unknown test error');
    } finally {
      setTestingGemini(false);
    }
  };

  const handleTestGroq = async () => {
    setTestingGroq(true);
    try {
      const res = await testGroqConnection(groqKey);
      if (res.success) {
        Alert.alert('Groq Connected Successfully', `Response from Groq:\n\n${res.message}`);
      } else {
        Alert.alert('Groq Connection Failed', res.message);
      }
    } catch (e) {
      Alert.alert('Groq Test Error', e instanceof Error ? e.message : 'Unknown test error');
    } finally {
      setTestingGroq(false);
    }
  };

  // Geocode address search
  const handleSearchCampus = async () => {
    if (!campusSearch.trim()) return Alert.alert('Enter a university or campus address to search');
    setIsSearchingLocation(true);
    try {
      const match = await geocodeCampusAddress(campusSearch);
      if (match) {
        setCampusLat(String(match.latitude));
        setCampusLon(String(match.longitude));
        setResolvedLocationName(match.displayName);
        Alert.alert('Location Found', `Resolved: ${match.displayName}\nLatitude: ${match.latitude}\nLongitude: ${match.longitude}`);
      } else {
        Alert.alert('Location Not Found', 'Could not find coordinates for that query. Try typing the full university name and city, or enter coordinates manually.');
      }
    } catch (e) {
      Alert.alert('Search Error', e instanceof Error ? e.message : 'Geocoding failed');
    } finally {
      setIsSearchingLocation(false);
    }
  };

  // Use current GPS location
  const handleUseCurrentLocation = async () => {
    setIsLocatingCurrent(true);
    try {
      const pos = await getCurrentCampusLocation();
      if (pos) {
        setCampusLat(String(pos.latitude));
        setCampusLon(String(pos.longitude));
        setResolvedLocationName('Current Device Location');
        Alert.alert('Current Position Acquired', `Latitude: ${pos.latitude}\nLongitude: ${pos.longitude}`);
      }
    } catch (e) {
      Alert.alert('Location Error', e instanceof Error ? e.message : 'Could not obtain current GPS position');
    } finally {
      setIsLocatingCurrent(false);
    }
  };

  // Save Campus location & settings
  const saveCampus = async () => {
    const lat = Number(campusLat);
    const lon = Number(campusLon);
    const radius = Number(campusRadius);

    if (campusLat.trim() && lon && (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180)) {
      return Alert.alert('Enter valid latitude (-90 to 90) and longitude (-180 to 180)');
    }
    if (!Number.isFinite(radius) || radius < 50) {
      return Alert.alert('Enter a valid radius of at least 50 metres');
    }

    let isEnabledFinal = campusEnabled;

    if (campusEnabled) {
      if (!campusLat.trim() || !campusLon.trim()) {
        return Alert.alert('Set campus latitude and longitude before enabling arrival checks');
      }

      const notifGranted = await configureNotifications();
      if (!notifGranted) {
        isEnabledFinal = false;
        setCampusEnabled(false);
        Alert.alert('Notification Permission Needed', 'Notifications are disabled. Coordinates were saved, but campus reminders will stay off until notifications are permitted.');
      }

      const locGranted = await requestCampusLocationPermission();
      if (!locGranted) {
        isEnabledFinal = false;
        setCampusEnabled(false);
        Alert.alert('Location Permission Needed', 'Location permission was denied. Coordinates were saved, but arrival reminders will stay off until location permission is enabled in Android Settings.');
      }
    }

    // Always persist coordinates and settings to SQLite
    await Promise.all([
      setSetting('campus_latitude', campusLat.trim()),
      setSetting('campus_longitude', campusLon.trim()),
      setSetting('campus_radius', campusRadius.trim() || '200'),
      setSetting('campus_location_enabled', String(isEnabledFinal)),
    ]);

    console.log('[Settings] Campus settings successfully saved ->', {
      lat: campusLat,
      lon: campusLon,
      radius: campusRadius,
      enabled: isEnabledFinal,
    });

    if (isEnabledFinal) {
      Alert.alert('Campus Settings Saved', 'Your university coordinates and arrival reminders are active.');
    } else if (!campusEnabled) {
      Alert.alert('Campus Coordinates Saved', 'Coordinates saved. Arrival reminders are currently disabled.');
    }
  };

  const saveReminderSettings = async () => {
    await setReminderPreferences(preferences);
    const [slots, tasks] = await Promise.all([getSlots(), getTasks()]);
    const results = await Promise.all([
      rescheduleAllClassReminders(slots, preferences),
      rescheduleAllDueReminders(tasks, preferences),
      rescheduleAttendancePrompts(slots, preferences),
      rescheduleStudyPlanReminders(preferences),
      rescheduleWeeklyDigest(preferences),
    ]);
    Alert.alert(
      results.every(Boolean) ? 'Reminder settings saved' : 'Notification permission needed',
      results.every(Boolean)
        ? undefined
        : 'Your preferences were saved, but notifications could not be scheduled. Allow notifications in Android Settings and save again.'
    );
  };

  const exportBackup = async () => {
    Alert.alert(
      'Export unencrypted backup?',
      'The JSON file includes notes, attachments, contacts, expenses, project members, and campus coordinates. Share and store it carefully.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Export',
          onPress: async () => {
            try {
              const file = `${FileSystem.documentDirectory}studyhub-backup-${new Date().toISOString().slice(0, 10)}.json`;
              await FileSystem.writeAsStringAsync(file, await exportDatabase());
              if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(file, { mimeType: 'application/json' });
              }
            } catch {
              Alert.alert('Could not export backup');
            }
          },
        },
      ]
    );
  };

  const importBackup = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: 'application/json',
      copyToCacheDirectory: true,
    });
    const asset = picked.assets?.[0];
    if (picked.canceled || !asset) return;

    Alert.alert('Replace current data?', 'This replaces all StudyHub local data with the backup file.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restore',
        style: 'destructive',
        onPress: async () => {
          try {
            await restoreDatabase(await FileSystem.readAsStringAsync(asset.uri));
            const [restoredSlots, restoredTasks, restoredPreferences] = await Promise.all([
              getSlots(),
              getTasks(),
              getReminderPreferences(),
            ]);
            await Promise.all([
              rescheduleAllClassReminders(restoredSlots, restoredPreferences),
              rescheduleAllDueReminders(restoredTasks, restoredPreferences),
              rescheduleAttendancePrompts(restoredSlots, restoredPreferences),
              rescheduleStudyPlanReminders(restoredPreferences),
              rescheduleWeeklyDigest(restoredPreferences),
            ]);
            await refresh();
            Alert.alert('Backup restored');
          } catch (e) {
            Alert.alert('Could not restore backup', e instanceof Error ? e.message : 'Invalid backup');
          }
        },
      },
    ]);
  };

  const addCourse = async () => {
    if (!newSubject.trim()) return;
    await addSubject({
      name: newSubject.trim(),
      code: null,
      teacher: null,
      color: [palette.clay, palette.moss, '#5878A6', '#946D42'][subjects.length % 4] ?? palette.clay,
    });
    setNewSubject('');
    await refresh();
  };

  return (
    <Screen theme={theme}>
      <Heading theme={theme} eyebrow="Make it yours">Settings</Heading>

      {/* AI PROVIDERS */}
      <Card theme={theme}>
        <Row
          theme={theme}
          title="AI providers"
          subtitle="API keys are kept strictly in secure device storage"
          right={<KeyRound color={theme.colors.accent} />}
        />

        {/* Gemini Key */}
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontWeight: '700', color: theme.colors.text }}>Google Gemini API Key</Text>
            <Pressable onPress={() => setShowGeminiKey(!showGeminiKey)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {showGeminiKey ? <EyeOff size={16} color={theme.colors.muted} /> : <Eye size={16} color={theme.colors.muted} />}
              <Text style={{ fontSize: 12, color: theme.colors.muted }}>{showGeminiKey ? 'Hide' : 'Show'}</Text>
            </Pressable>
          </View>
          <Input
            theme={theme}
            value={geminiKey}
            onChangeText={setGeminiKey}
            secureTextEntry={!showGeminiKey}
            placeholder="AIzaSy..."
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
            <Button
              theme={theme}
              label={testingGemini ? 'Testing Gemini…' : 'Test Gemini'}
              variant="secondary"
              disabled={testingGemini || !geminiKey.trim()}
              onPress={() => void handleTestGemini()}
            />
          </View>
        </View>

        {/* Groq Key */}
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontWeight: '700', color: theme.colors.text }}>Groq API Key (Text Fallback)</Text>
            <Pressable onPress={() => setShowGroqKey(!showGroqKey)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {showGroqKey ? <EyeOff size={16} color={theme.colors.muted} /> : <Eye size={16} color={theme.colors.muted} />}
              <Text style={{ fontSize: 12, color: theme.colors.muted }}>{showGroqKey ? 'Hide' : 'Show'}</Text>
            </Pressable>
          </View>
          <Input
            theme={theme}
            value={groqKey}
            onChangeText={setGroqKey}
            secureTextEntry={!showGroqKey}
            placeholder="gsk_..."
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
            <Button
              theme={theme}
              label={testingGroq ? 'Testing Groq…' : 'Test Groq'}
              variant="secondary"
              disabled={testingGroq || !groqKey.trim()}
              onPress={() => void handleTestGroq()}
            />
          </View>
        </View>

        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
          {geminiKey.trim() && groqKey.trim()
            ? 'Both providers configured — automatic fallback enabled.'
            : geminiKey.trim()
              ? 'Gemini only — text, vision, and document analysis work.'
              : groqKey.trim()
                ? 'Groq only — text features work; image import and document OCR require Gemini.'
                : 'No API keys set yet. Paste your Gemini or Groq key above.'}
        </Text>

        <Text style={{ color: theme.colors.text, fontWeight: '700' }}>Primary text provider</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['gemini', 'groq'] as AIProvider[]).map((v) => (
            <View key={v} style={{ flex: 1 }}>
              <Button
                theme={theme}
                label={v === 'gemini' ? 'Gemini (Primary)' : 'Groq (Primary)'}
                variant={primary === v ? 'primary' : 'secondary'}
                onPress={() => setPrimary(v)}
              />
            </View>
          ))}
        </View>

        <Button theme={theme} label="Save AI settings" onPress={() => void saveAI()} />
      </Card>

      {/* CAMPUS LOCATION & REMINDERS */}
      <Card theme={theme}>
        <Row
          theme={theme}
          title="Campus location & reminders"
          subtitle="Foreground GPS arrival check; zero background battery drain"
          right={<MapPin color={theme.colors.positive} />}
        />

        <Toggle
          theme={theme}
          label="Enable campus arrival checks"
          value={campusEnabled}
          onChange={setCampusEnabled}
        />

        {/* Address Search / Geocoding */}
        <View style={{ gap: 6, marginTop: 4 }}>
          <Text style={{ fontWeight: '700', color: theme.colors.text }}>Search Campus or Address</Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Input
                theme={theme}
                value={campusSearch}
                onChangeText={setCampusSearch}
                placeholder="e.g. COMSATS University Islamabad"
              />
            </View>
            <Button
              theme={theme}
              label={isSearchingLocation ? 'Searching…' : 'Find'}
              variant="secondary"
              disabled={isSearchingLocation}
              onPress={() => void handleSearchCampus()}
            />
          </View>
        </View>

        {/* Use Current GPS Location */}
        <Button
          theme={theme}
          label={isLocatingCurrent ? 'Detecting current GPS…' : 'Use My Current GPS Position'}
          variant="secondary"
          disabled={isLocatingCurrent}
          onPress={() => void handleUseCurrentLocation()}
        />

        {resolvedLocationName ? (
          <Text style={{ color: theme.colors.positive, fontSize: 12, fontWeight: '700' }}>
            Selected: {resolvedLocationName}
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Input
              theme={theme}
              label="Latitude"
              value={campusLat}
              onChangeText={setCampusLat}
              keyboardType="numbers-and-punctuation"
              placeholder="33.6844"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              theme={theme}
              label="Longitude"
              value={campusLon}
              onChangeText={setCampusLon}
              keyboardType="numbers-and-punctuation"
              placeholder="73.0479"
            />
          </View>
        </View>

        <Input
          theme={theme}
          label="Arrival radius (metres)"
          value={campusRadius}
          onChangeText={setCampusRadius}
          keyboardType="number-pad"
          placeholder="200"
        />

        <Button theme={theme} label="Save campus location" variant="secondary" onPress={() => void saveCampus()} />
      </Card>

      {/* REMINDER TIMING */}
      <Card theme={theme}>
        <Text style={{ fontWeight: '800', color: theme.colors.text }}>Reminder timing</Text>
        <Text style={{ color: theme.colors.muted, fontSize: 13 }}>Class lead time</Text>
        <Choice
          theme={theme}
          values={[5, 10, 15]}
          selected={preferences.classLeadMinutes}
          onSelect={(classLeadMinutes) => setPreferences({ ...preferences, classLeadMinutes })}
          suffix=" min"
        />
        <Toggle
          theme={theme}
          label="1 day before deadlines"
          value={preferences.deadlineOneDay}
          onChange={(deadlineOneDay) => setPreferences({ ...preferences, deadlineOneDay })}
        />
        <Toggle
          theme={theme}
          label="3 hours before deadlines"
          value={preferences.deadlineThreeHours}
          onChange={(deadlineThreeHours) => setPreferences({ ...preferences, deadlineThreeHours })}
        />
        <Toggle
          theme={theme}
          label="Ask attendance after class"
          value={preferences.attendancePrompts}
          onChange={(attendancePrompts) => setPreferences({ ...preferences, attendancePrompts })}
        />
        <Toggle
          theme={theme}
          label="Daily study plan at 8 AM"
          value={preferences.studyPlanReminder}
          onChange={(studyPlanReminder) => setPreferences({ ...preferences, studyPlanReminder })}
        />
        <Toggle
          theme={theme}
          label="Sunday weekly digest"
          value={preferences.weeklyDigest}
          onChange={(weeklyDigest) => setPreferences({ ...preferences, weeklyDigest })}
        />
        <Input
          theme={theme}
          label="Digest hour (0–23)"
          value={String(preferences.weeklyDigestHour)}
          onChangeText={(value) => setPreferences({ ...preferences, weeklyDigestHour: Number(value) || 0 })}
          keyboardType="number-pad"
        />
        <Button
          theme={theme}
          label="Save & reschedule reminders"
          variant="secondary"
          onPress={() => void saveReminderSettings()}
        />
      </Card>

      {/* ATTENDANCE TARGET */}
      <Card theme={theme}>
        <Text style={{ fontWeight: '800', color: theme.colors.text }}>Attendance target</Text>
        <Input
          theme={theme}
          label="Minimum attendance %"
          value={attendanceThreshold}
          onChangeText={setAttendanceThreshold}
          keyboardType="number-pad"
        />
        <Button
          theme={theme}
          label="Save target"
          variant="secondary"
          onPress={async () => {
            const n = Number(attendanceThreshold);
            if (n < 1 || n > 100) return Alert.alert('Enter 1–100');
            await setSetting('attendance_threshold', String(n));
            Alert.alert('Attendance target saved');
          }}
        />
      </Card>

      {/* EXPENSE CATEGORIES */}
      <Card theme={theme}>
        <Text style={{ fontWeight: '800', color: theme.colors.text }}>Expense categories</Text>
        <Input
          theme={theme}
          label="Comma-separated categories"
          value={categories}
          onChangeText={setCategories}
        />
        <Button
          theme={theme}
          label="Save categories"
          variant="secondary"
          onPress={async () => {
            await setSetting('expense_categories', categories);
            Alert.alert('Categories saved');
          }}
        />
      </Card>

      {/* APPEARANCE */}
      <Card theme={theme}>
        <Text style={{ fontWeight: '800', color: theme.colors.text }}>Appearance</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['light', 'dark', 'system'] as const).map((v) => (
            <View key={v} style={{ flex: 1 }}>
              <Button
                theme={theme}
                label={v}
                variant={appTheme === v ? 'primary' : 'secondary'}
                onPress={async () => {
                  setTheme(v);
                  await setSetting('theme', v);
                }}
              />
            </View>
          ))}
        </View>
      </Card>

      {/* COURSES / PROFILE */}
      <Card theme={theme}>
        <Text style={{ fontWeight: '800', color: theme.colors.text }}>{semester}</Text>
        <Input theme={theme} label="Profile label" value={semester} onChangeText={setSemester} />
        <Button
          theme={theme}
          label="Save profile"
          variant="secondary"
          onPress={async () => {
            await setSetting('semester', semester);
            Alert.alert('Profile saved');
          }}
        />
        {subjects.map((subject) => (
          <Row
            key={subject.id}
            theme={theme}
            title={subject.name}
            right={
              <Pressable
                onPress={() =>
                  Alert.alert(
                    'Delete course?',
                    `Deleting ${subject.name} removes its timetable, attendance, exams, study plan, patterns, and contact. Other linked content (tasks, notes) becomes unlinked.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: async () => {
                          await deleteSubject(subject.id);
                          const remainingSlots = await getSlots();
                          await Promise.all([
                            rescheduleAllClassReminders(remainingSlots),
                            rescheduleAllDueReminders(await getTasks()),
                            rescheduleAttendancePrompts(remainingSlots),
                            rescheduleStudyPlanReminders(),
                            rescheduleWeeklyDigest(),
                          ]);
                          await refresh();
                        },
                      },
                    ]
                  )
                }
              >
                <Trash2 color={theme.colors.danger} size={18} />
              </Pressable>
            }
          />
        ))}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Input theme={theme} value={newSubject} onChangeText={setNewSubject} placeholder="Add a course" />
          </View>
          <Button theme={theme} label="Add" onPress={() => void addCourse()} />
        </View>
      </Card>

      {/* BACKUP & RESTORE */}
      <Card theme={theme}>
        <Text style={{ fontWeight: '800', color: theme.colors.text }}>Your data</Text>
        <Button theme={theme} label="Export JSON backup" variant="secondary" onPress={() => void exportBackup()} />
        <Button theme={theme} label="Import JSON backup" variant="secondary" onPress={() => void importBackup()} />
      </Card>
    </Screen>
  );
}

function Choice({
  theme,
  values,
  selected,
  onSelect,
  suffix,
}: {
  theme: AppTheme;
  values: number[];
  selected: number;
  onSelect: (v: number) => void;
  suffix: string;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {values.map((v) => (
        <Pressable
          key={v}
          onPress={() => onSelect(v)}
          style={{
            flex: 1,
            padding: 10,
            alignItems: 'center',
            borderRadius: 11,
            backgroundColor: selected === v ? theme.colors.accent : theme.colors.surfaceSoft,
          }}
        >
          <Text style={{ fontWeight: '800', color: selected === v ? '#fff' : theme.colors.text }}>
            {v}
            {suffix}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Toggle({
  theme,
  label,
  value,
  onChange,
}: {
  theme: AppTheme;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 5,
      }}
    >
      <Text style={{ color: theme.colors.text, fontWeight: '700', flex: 1 }}>{label}</Text>
      <View
        style={{
          width: 42,
          height: 24,
          borderRadius: 12,
          padding: 3,
          alignItems: value ? 'flex-end' : 'flex-start',
          backgroundColor: value ? theme.colors.accent : theme.colors.border,
        }}
      >
        <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' }} />
      </View>
    </Pressable>
  );
}
