# 🎓 StudyHub — Offline-First Student Productivity Suite

<div align="center">

![StudyHub Banner](https://img.shields.io/badge/StudyHub-Student%20OS-6366F1?style=for-the-badge&logo=academic-tree&logoColor=white)

[![Expo SDK](https://img.shields.io/badge/Expo-SDK%2054-000020?style=for-the-badge&logo=expo&logoColor=white)](https://expo.dev)
[![React Native](https://img.shields.io/badge/React%20Native-0.81-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactnative.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![SQLite](https://img.shields.io/badge/SQLite-Offline%20First-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

**An intelligent, offline-first personal academic companion built for university and college students.**  
*Zero cloud dependencies, complete privacy, instant local SQLite storage, and optional on-device AI acceleration.*

[Key Features](#-features) • [Architecture](#-architecture--privacy) • [Getting Started](#-getting-started) • [Building APK](#-building-the-android-apk) • [Contributing](#-contributing)

</div>

---

## 🌟 Why StudyHub?

Most student productivity apps require continuous internet connectivity, recurring subscriptions, and harvest user study habits onto remote cloud servers. 

**StudyHub** is engineered with a strict **Offline-First, Privacy-First** philosophy:
- 🔒 **100% Local Storage**: Your notes, schedules, attendance, grades, and expenses never leave your device.
- ⚡ **Zero Latency**: Powered by local embedded SQLite with instant reads and transactional writes.
- 🤖 **Dual-Engine AI (Optional)**: Connect your own Google Gemini or Groq API keys (stored securely in Android Keystore / iOS Keychain) for OCR and natural language task generation. When offline, all core functions continue to work seamlessly.

---

## ✨ Features

### 📝 1. Notion-Style Modular Notes & File Attachments
- **Block-Based Editor**: Create structured notes using headings, paragraphs, bullet points, numbered lists, interactive checklists, code blocks, and dividers.
- **Multimodal File Attachments**: Attach lecture slides, PDFs, DOCX, and high-resolution images directly to any note block.
- **AI Text Extraction (OCR)**: Extract printed or handwritten text from attached lecture handouts and whiteboards into editable note blocks using Gemini Vision.

### 🎙️ 2. Voice Note → Auto Task Extraction
- **Spoken Task Capture**: Dictate thoughts naturally (e.g., *"Submit discrete math assignment next Tuesday by 4 PM and review quiz topics"*).
- **Intelligent Entity Resolution**: The AI parses due dates, maps tasks to existing enrolled subjects, and assigns priority levels.
- **Review & Confirm Guardrail**: Every extracted draft is presented in an interactive review modal—nothing is saved without student confirmation.

### 📅 3. Smart Timetable & Class Reminders
- **Weekly Schedule Matrix**: Track lectures, labs, and tutorials by day, room, and instructor.
- **Exact Class Alarms**: Automated local notifications triggered 5 minutes before each lecture via Android exact alarms.
- **Timetable Scanner**: Import your semester schedule directly from a photo or syllabus snapshot using multimodal vision parsing.

### ✅ 4. Task, Assignment & Quiz Tracker
- Track assignments, quizzes, midterms, and daily todos.
- Priority tagging (High, Medium, Low) with smart overdue filters.
- Direct links between tasks and academic subjects.

### 📊 5. Attendance Tracker with Low-Attendance Alerts
- Log status for every class slot: **Present**, **Absent**, or **Cancelled**.
- Real-time attendance percentage calculations per subject.
- Automated warning alerts whenever attendance falls below the mandatory 75% university threshold.

### 🎯 6. GPA Calculator & Transcript Importer
- Semester-by-semester GPA and CGPA tracking.
- Distinguish between **Expected** and **Actual** grades for projection planning.
- Import grades directly from official transcript snapshots.

### 🧠 7. Spaced Repetition Flashcards & Quizzes
- Create flashcard decks organized by subject or extracted from notes.
- Self-assessment review mode with confidence tracking (Correct / Incorrect).
- Automatic question generation from lecture notes.

### 💰 8. Student Expense & Budget Tracker
- Log everyday campus expenses categorized into **Food**, **Transport**, **Hostel/Mess**, and **Academics**.
- Weekly financial summaries and budget burn-down insights.

### 📍 9. Campus Geofencing & Location Awareness
- Store campus coordinates with automatic OpenStreetMap Nominatim geocoding.
- Location-aware reminders to check in or review pending tasks upon arriving at campus.

### 💾 10. Database Backup & Portability
- Export your entire academic profile and database into a single JSON file.
- One-click restore ensures full data portability when upgrading devices.

---

## 🏗️ Architecture & Privacy

```
┌──────────────────────────────────────────────────────────────┐
│                        StudyHub App                          │
│          (React Native 0.81 + Expo SDK 54 + TypeScript)       │
├──────────────────────────────┬───────────────────────────────┤
│         Offline Layer        │      Optional AI Cloud        │
├──────────────────────────────┼───────────────────────────────┤
│ • SQLite (studyhub.db)       │ • Google Gemini 2.0 Flash     │
│ • Local File System Storage  │ • Groq (LLaMA 3.3 70B)        │
│ • Android Alarm Manager      │ • Multimodal Vision OCR       │
│ • SecureStore (Hardware Key) │ • SecureStore API Key Storage │
└──────────────────────────────┴───────────────────────────────┘
```

- **Persistence**: Embedded SQLite database (`expo-sqlite`) with automatic schema initialization and indexed queries.
- **Security**: Sensitive user API keys are encrypted at hardware level using `expo-secure-store` (Android Keystore / iOS Keychain).
- **Network Independence**: The app contains zero proprietary backend servers, zero telemetry trackers, and zero required logins.

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org) (v18 or v20 LTS recommended)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)
- [Android Studio](https://developer.android.com/studio) (for local emulator or USB debugging)

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/riazaslam029/StudyHub.git
   cd StudyHub
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Verify project health**:
   ```bash
   npx expo-doctor
   npm run typecheck
   npm run lint
   ```

4. **Start development server**:
   ```bash
   npm start
   ```

---

## 📱 Building the Android APK

StudyHub includes pre-configured build profiles via Expo Application Services (EAS):

1. **Install EAS CLI**:
   ```bash
   npm install -g eas-cli
   ```

2. **Login to your Expo account**:
   ```bash
   eas login
   ```

3. **Build standalone APK**:
   ```bash
   eas build -p android --profile preview
   ```
   *The `preview` profile builds an installable `.apk` package that can be sideloaded directly onto any Android device.*

---

## 📂 Project Structure

```
StudyHub/
├── assets/                  # App icons, splash screens, and static media
├── src/
│   ├── screens/             # UI Screen components
│   │   ├── DashboardScreen.tsx      # Main summary & quick actions
│   │   ├── NotesScreen.tsx          # Notion-style block editor & attachments
│   │   ├── TasksScreen.tsx          # Tasks, filters, and voice modal
│   │   ├── TimetableScreen.tsx      # Weekly timetable schedule
│   │   ├── AttendanceScreen.tsx     # Attendance tracking & warnings
│   │   ├── GpaScreen.tsx            # GPA calculator & grade projections
│   │   ├── FlashcardsScreen.tsx     # Spaced repetition study decks
│   │   ├── ExpensesScreen.tsx       # Student budget & expense tracking
│   │   ├── SettingsScreen.tsx       # AI keys, diagnostics, DB backup
│   │   └── ...                      # Additional feature screens
│   ├── ai.ts                # Dual Gemini / Groq API client & OCR
│   ├── components.tsx       # Reusable UI design system primitives
│   ├── db.ts                # SQLite database migrations & queries
│   ├── location.ts          # Campus geocoding & location services
│   ├── navigation.tsx       # Bottom tabs & stack navigators
│   ├── notifications.ts     # Local notification scheduling engine
│   ├── theme.ts             # Color palette, spacing, and typography
│   ├── types.ts             # Domain models & TypeScript interfaces
│   └── voice.tsx            # Speech recognition audio handler
├── app.json                 # Expo application configuration & plugins
├── eas.json                 # EAS build profiles (APK preview, production)
└── package.json             # Pinned dependencies & scripts
```

---

## 🤝 Contributing

Contributions, feature suggestions, and bug reports are welcome!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feat/AmazingFeature`)
3. Commit your Changes (`git commit -m "feat(module): add amazing feature"`)
4. Push to the Branch (`git push origin feat/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.

<div align="center">
  <sub>Built with ❤️ by <a href="https://github.com/riazaslam029">Riaz Aslam</a></sub>
</div>
