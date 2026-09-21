export type Subject = { id: number; name: string; code: string | null; color: string; teacher: string | null };
export type Slot = { id: number; subject_id: number; day_of_week: number; start_time: string; end_time: string; room: string | null; teacher?: string | null; subject_name?: string; subject_color?: string };
export type TaskType = 'assignment' | 'quiz' | 'exam' | 'todo';
export type TaskStatus = 'pending' | 'in-progress' | 'done';
export type Priority = 'low' | 'medium' | 'high';
export type Task = { id: number; title: string; type: TaskType; subject_id: number | null; due_at: string | null; priority: Priority; status: TaskStatus; notes: string | null; recurring: string | null; campus_reminder?: number; created_at?: string; subject_name?: string; subject_color?: string };
export type NoteBlock = { id: string; type: 'heading' | 'paragraph' | 'bullet' | 'numbered' | 'checkbox' | 'code' | 'divider' | 'image'; text?: string; checked?: boolean; url?: string; caption?: string; attachment_id?: number };
export type Attachment = { id: number; note_id: number; file_path: string; file_type: string; original_filename: string; file_size: number; created_at: string };
export type Note = { id: number; title: string; content_json: string; folder_id: number | null; subject_id: number | null; updated_at: string; subject_name?: string; subject_color?: string; attachments?: Attachment[] };
export type AiSource = { id: number; subject_id: number; raw_text: string; created_at: string; subject_name?: string };

export type SpokenTaskDraft = {
  title: string;
  type: TaskType;
  subject_name: string | null;
  subject_id: number | null;
  due_at: string | null;
  priority: Priority;
  notes: string | null;
  raw_transcript: string;
};

export type AttendanceStatus = 'present' | 'absent' | 'cancelled';
export type AttendanceRecord = { id: number; date: string; subject_id: number; timetable_slot_id: number | null; status: AttendanceStatus; created_at: string; updated_at: string };
export type TodayAttendance = Subject & { timetable_slot_id: number; start_time: string; end_time: string; room: string | null; attendance_status: AttendanceStatus | null };
export type AttendanceSummary = Subject & { present_count: number; absent_count: number; cancelled_count: number; total_count: number; percentage: number | null };

export const gradePoints = { A: 4, 'A-': 3.67, 'B+': 3.33, B: 3, 'B-': 2.67, 'C+': 2.33, C: 2, 'C-': 1.67, D: 1, F: 0 } as const;
export type LetterGrade = keyof typeof gradePoints;
export type GradeKind = 'expected' | 'actual';
export type Semester = { id: number; name: string; created_at: string; gpa?: number; total_credits?: number };
export type SemesterSubject = { id: number; semester_id: number; subject_id: number | null; subject_name: string; credit_hours: number; grade: LetterGrade; grade_points: number; grade_kind: GradeKind };

export type Flashcard = { id: number; subject_id: number | null; note_id: number | null; front: string; back: string; correct_count: number; incorrect_count: number; created_at: string; subject_name?: string; note_title?: string };
export type FlashcardDraft = { front: string; back: string };
export type FlashcardGroup = { subject_id: number | null; subject_name: string; card_count: number; correct_count: number; incorrect_count: number };

export type TimetableDraft = { subject: string; day: string; start_time: string; end_time: string; room: string; teacher?: string };
export type GradeDraft = { subject: string; credit_hours: string; grade: string; marks?: string };

export type ExamType = 'quiz' | 'midterm' | 'final';
export type Exam = { id: number; subject_id: number; exam_at: string; exam_type: ExamType; topics: string; created_at: string; subject_name?: string; subject_color?: string };
export type StudyPlanItem = { id: number; exam_id: number; subject_id: number; plan_date: string; topic: string; done: number; exam_type?: ExamType; exam_at?: string; subject_name?: string };
export type RecurringTopic = { id: number; subject_id: number; topic: string; frequency: number; notes: string | null; subject_name?: string };
export type ExpenseCategory = 'Food' | 'Transport' | 'Hostel/Mess' | 'Other' | string;
export type Expense = { id: number; amount_minor: number; category: string; note: string | null; spent_on: string; created_at: string };
export type ExpenseSummary = { category: string; total_minor: number };
export type GroupProject = { id: number; title: string; subject_id: number | null; due_at: string | null; members: string | null; created_at: string; subject_name?: string; item_count?: number; done_count?: number };
export type GroupProjectItem = { id: number; project_id: number; title: string; done: number };
export type SubjectContact = { id: number; subject_id: number; teacher_name: string; office_hours: string | null; phone: string | null; email: string | null; notes: string | null; subject_name?: string };
