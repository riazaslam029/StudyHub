import * as SQLite from 'expo-sqlite';
import {
  AiSource, Attachment, AttendanceStatus, AttendanceSummary, Exam, ExamType, Expense, ExpenseSummary, Flashcard, FlashcardDraft, FlashcardGroup,
  GradeKind, GroupProject, GroupProjectItem, LetterGrade, Note, RecurringTopic, Semester, SemesterSubject, Slot, StudyPlanItem, Subject, SubjectContact, Task, TaskStatus,
  TodayAttendance, gradePoints,
} from './types';

const database = SQLite.openDatabaseSync('studyhub.db');
const now = () => new Date().toISOString();

export async function initializeDatabase() {
  await database.execAsync(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT);
    CREATE TABLE IF NOT EXISTS subjects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, code TEXT, color TEXT NOT NULL DEFAULT '#C95732', teacher TEXT);
    CREATE TABLE IF NOT EXISTS timetable_slots (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id INTEGER NOT NULL, day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6), start_time TEXT NOT NULL, end_time TEXT NOT NULL, room TEXT, teacher TEXT, FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS folders (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, parent_id INTEGER, created_at TEXT NOT NULL, FOREIGN KEY(parent_id) REFERENCES folders(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content_json TEXT NOT NULL DEFAULT '[]', folder_id INTEGER, subject_id INTEGER, updated_at TEXT NOT NULL, FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE SET NULL, FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS ai_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id INTEGER NOT NULL, raw_text TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('assignment','quiz','exam','todo')), subject_id INTEGER, due_at TEXT, priority TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'pending', notes TEXT, recurring TEXT, created_at TEXT NOT NULL, FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, subject_id INTEGER NOT NULL, timetable_slot_id INTEGER, status TEXT NOT NULL CHECK(status IN ('present','absent','cancelled')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(date, timetable_slot_id), FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE, FOREIGN KEY(timetable_slot_id) REFERENCES timetable_slots(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS semesters (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS semester_subjects (id INTEGER PRIMARY KEY AUTOINCREMENT, semester_id INTEGER NOT NULL, subject_id INTEGER, subject_name TEXT NOT NULL, credit_hours REAL NOT NULL CHECK(credit_hours > 0), grade TEXT NOT NULL, grade_points REAL NOT NULL, grade_kind TEXT NOT NULL DEFAULT 'actual', FOREIGN KEY(semester_id) REFERENCES semesters(id) ON DELETE CASCADE, FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS flashcards (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id INTEGER, note_id INTEGER, front TEXT NOT NULL, back TEXT NOT NULL, correct_count INTEGER NOT NULL DEFAULT 0, incorrect_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE SET NULL, FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS exams (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id INTEGER NOT NULL, exam_at TEXT NOT NULL, exam_type TEXT NOT NULL CHECK(exam_type IN ('quiz','midterm','final')), topics TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS study_plan_items (id INTEGER PRIMARY KEY AUTOINCREMENT, exam_id INTEGER NOT NULL, subject_id INTEGER NOT NULL, plan_date TEXT NOT NULL, topic TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, UNIQUE(exam_id,plan_date), FOREIGN KEY(exam_id) REFERENCES exams(id) ON DELETE CASCADE, FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS recurring_topics (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id INTEGER NOT NULL, topic TEXT NOT NULL, frequency INTEGER NOT NULL DEFAULT 1, notes TEXT, FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, amount_minor INTEGER NOT NULL CHECK(amount_minor>=0), category TEXT NOT NULL, note TEXT, spent_on TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS group_projects (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, subject_id INTEGER, due_at TEXT, members TEXT, created_at TEXT NOT NULL, FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS group_project_items (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(project_id) REFERENCES group_projects(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS subject_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id INTEGER NOT NULL UNIQUE, teacher_name TEXT NOT NULL, office_hours TEXT, phone TEXT, email TEXT, notes TEXT, FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_subject ON tasks(subject_id);
    CREATE INDEX IF NOT EXISTS idx_notes_subject ON notes(subject_id);
    CREATE INDEX IF NOT EXISTS idx_slots_subject ON timetable_slots(subject_id);
    CREATE INDEX IF NOT EXISTS idx_sources_subject ON ai_sources(subject_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_subject_date ON attendance(subject_id, date);
    CREATE INDEX IF NOT EXISTS idx_semester_subjects_semester ON semester_subjects(semester_id);
    CREATE INDEX IF NOT EXISTS idx_flashcards_subject ON flashcards(subject_id);
    CREATE TABLE IF NOT EXISTS attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, note_id INTEGER NOT NULL, file_path TEXT NOT NULL, file_type TEXT NOT NULL, original_filename TEXT NOT NULL, file_size INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS idx_attachments_note ON attachments(note_id);
    CREATE INDEX IF NOT EXISTS idx_exams_date ON exams(exam_at);
    CREATE INDEX IF NOT EXISTS idx_study_plan_date ON study_plan_items(plan_date);
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(spent_on);
    CREATE INDEX IF NOT EXISTS idx_projects_due ON group_projects(due_at);`);
  const attendanceColumns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(attendance)');
  if (!attendanceColumns.some((column) => column.name === 'timetable_slot_id')) {
    await database.execAsync(`CREATE TABLE attendance_v2 (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, subject_id INTEGER NOT NULL, timetable_slot_id INTEGER, status TEXT NOT NULL CHECK(status IN ('present','absent','cancelled')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(date,timetable_slot_id), FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE, FOREIGN KEY(timetable_slot_id) REFERENCES timetable_slots(id) ON DELETE SET NULL);
      INSERT OR IGNORE INTO attendance_v2(date,subject_id,timetable_slot_id,status,created_at,updated_at) SELECT a.date,a.subject_id,(SELECT ts.id FROM timetable_slots ts WHERE ts.subject_id=a.subject_id AND ts.day_of_week=CAST(strftime('%w',a.date) AS INTEGER) ORDER BY ts.start_time LIMIT 1),a.status,a.created_at,a.updated_at FROM attendance a;
      DROP TABLE attendance; ALTER TABLE attendance_v2 RENAME TO attendance; CREATE INDEX IF NOT EXISTS idx_attendance_subject_date ON attendance(subject_id,date);`);
  }
  const attendanceHistoryMigration = await getSetting('attendance_history_preserved_v1');
  if (attendanceHistoryMigration !== 'true') {
    await database.withTransactionAsync(async () => {
      await database.execAsync(`CREATE TABLE attendance_history (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, subject_id INTEGER NOT NULL, timetable_slot_id INTEGER, status TEXT NOT NULL CHECK(status IN ('present','absent','cancelled')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(date,timetable_slot_id), FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE, FOREIGN KEY(timetable_slot_id) REFERENCES timetable_slots(id) ON DELETE SET NULL); INSERT OR IGNORE INTO attendance_history SELECT * FROM attendance; DROP TABLE attendance; ALTER TABLE attendance_history RENAME TO attendance; CREATE INDEX IF NOT EXISTS idx_attendance_subject_date ON attendance(subject_id,date);`);
    });
    await setSetting('attendance_history_preserved_v1','true');
  }
  const taskColumns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(tasks)');
  if (!taskColumns.some((column) => column.name === 'campus_reminder')) await database.execAsync('ALTER TABLE tasks ADD COLUMN campus_reminder INTEGER NOT NULL DEFAULT 0');
  if (await getSetting('onboarded') === null) await setSetting('onboarded', 'false');
  if (await getSetting('attendance_threshold') === null) await setSetting('attendance_threshold', '75');
}

export async function getSetting(key: string) { const row = await database.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]); return row?.value ?? null; }
export async function setSetting(key: string, value: string) { await database.runAsync('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]); }

export async function getSubjects() { return database.getAllAsync<Subject>('SELECT * FROM subjects ORDER BY name'); }
export async function addSubject(subject: Omit<Subject, 'id'>) { const r = await database.runAsync('INSERT INTO subjects(name,code,color,teacher) VALUES(?,?,?,?)', [subject.name, subject.code, subject.color, subject.teacher]); return r.lastInsertRowId; }
export async function deleteSubject(id: number) {
  await database.withTransactionAsync(async () => {
    await database.runAsync('DELETE FROM timetable_slots WHERE subject_id=?', [id]);
    await database.runAsync('DELETE FROM attendance WHERE subject_id=?', [id]);
    await database.runAsync('DELETE FROM exams WHERE subject_id=?', [id]);
    await database.runAsync('DELETE FROM study_plan_items WHERE subject_id=?', [id]);
    await database.runAsync('DELETE FROM recurring_topics WHERE subject_id=?', [id]);
    await database.runAsync('DELETE FROM subject_contacts WHERE subject_id=?', [id]);
    await database.runAsync('DELETE FROM ai_sources WHERE subject_id=?', [id]);
    await database.runAsync('UPDATE tasks SET subject_id=NULL WHERE subject_id=?', [id]);
    await database.runAsync('UPDATE notes SET subject_id=NULL WHERE subject_id=?', [id]);
    await database.runAsync('UPDATE group_projects SET subject_id=NULL WHERE subject_id=?', [id]);
    await database.runAsync('UPDATE flashcards SET subject_id=NULL WHERE subject_id=?', [id]);
    await database.runAsync('UPDATE semester_subjects SET subject_id=NULL WHERE subject_id=?', [id]);
    await database.runAsync('DELETE FROM subjects WHERE id=?', [id]);
  });
}
export async function findSubjectByName(name: string) { return database.getFirstAsync<Subject>('SELECT * FROM subjects WHERE lower(trim(name))=lower(trim(?)) LIMIT 1', [name]); }

export async function getSlots(day?: number) { const where = day === undefined ? '' : 'WHERE s.day_of_week=?'; return database.getAllAsync<Slot>(`SELECT s.*,sub.name subject_name,sub.color subject_color FROM timetable_slots s JOIN subjects sub ON sub.id=s.subject_id ${where} ORDER BY s.day_of_week,s.start_time`, day === undefined ? [] : [day]); }
export async function addSlot(slot: Omit<Slot, 'id' | 'subject_name' | 'subject_color'>) { return database.runAsync('INSERT INTO timetable_slots(subject_id,day_of_week,start_time,end_time,room,teacher) VALUES(?,?,?,?,?,?)', [slot.subject_id, slot.day_of_week, slot.start_time, slot.end_time, slot.room, slot.teacher ?? null]); }
export async function deleteSlot(id: number) { await database.runAsync('DELETE FROM timetable_slots WHERE id=?', [id]); }
export async function clearSlots() { await database.runAsync('DELETE FROM timetable_slots'); }
export type ConfirmedSlotDraft = { subject: string; day_of_week: number; start_time: string; end_time: string; room: string | null; teacher: string | null };
export async function importTimetableRows(rows: ConfirmedSlotDraft[], replace: boolean) {
  let inserted = 0;
  await database.withTransactionAsync(async () => {
    if (replace) await database.runAsync('DELETE FROM timetable_slots');
    for (const row of rows) {
      let subject = await findSubjectByName(row.subject);
      if (!subject) { const result = await addSubject({ name: row.subject.trim(), code: null, color: ['#C95732','#31715F','#5878A6','#946D42','#A05773'][inserted % 5] ?? '#C95732', teacher: row.teacher }); subject = { id: Number(result), name: row.subject.trim(), code: null, color: '#C95732', teacher: row.teacher }; }
      const duplicate = await database.getFirstAsync<{ id: number }>('SELECT id FROM timetable_slots WHERE subject_id=? AND day_of_week=? AND start_time=? AND end_time=?', [subject.id, row.day_of_week, row.start_time, row.end_time]);
      if (!duplicate) { await addSlot({ subject_id: subject.id, day_of_week: row.day_of_week, start_time: row.start_time, end_time: row.end_time, room: row.room, teacher: row.teacher }); inserted += 1; }
    }
  });
  return inserted;
}

export async function getTasks(options: { status?: TaskStatus; today?: boolean } = {}) { let sql = 'SELECT t.*,s.name subject_name,s.color subject_color FROM tasks t LEFT JOIN subjects s ON s.id=t.subject_id'; const clauses: string[] = []; const params: string[] = []; if (options.status) { clauses.push('t.status=?'); params.push(options.status); } if (options.today) clauses.push("date(t.due_at,'localtime')=date('now','localtime')"); if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`; sql += " ORDER BY CASE WHEN t.status='done' THEN 1 ELSE 0 END,t.due_at IS NULL,t.due_at"; return database.getAllAsync<Task>(sql, params); }
export async function saveTask(task: Omit<Task, 'id' | 'subject_name' | 'subject_color'>) { const r = await database.runAsync('INSERT INTO tasks(title,type,subject_id,due_at,priority,status,notes,recurring,campus_reminder,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', [task.title, task.type, task.subject_id, task.due_at, task.priority, task.status, task.notes, task.recurring, task.campus_reminder ?? 0, now()]); return r.lastInsertRowId; }
export async function updateTaskStatus(id: number, status: TaskStatus) { await database.runAsync('UPDATE tasks SET status=? WHERE id=?', [status, id]); }
export async function deleteTask(id: number) { await database.runAsync('DELETE FROM tasks WHERE id=?', [id]); }

export async function getNotes(query = '') { return database.getAllAsync<Note>('SELECT n.*,s.name subject_name,s.color subject_color FROM notes n LEFT JOIN subjects s ON s.id=n.subject_id WHERE n.title LIKE ? OR n.content_json LIKE ? ORDER BY n.updated_at DESC', [`%${query}%`, `%${query}%`]); }
export async function getNote(id: number) {
  const note = await database.getFirstAsync<Note>('SELECT n.*,s.name subject_name,s.color subject_color FROM notes n LEFT JOIN subjects s ON s.id=n.subject_id WHERE n.id=?', [id]);
  if (!note) return null;
  const attachments = await getAttachments(id);
  return { ...note, attachments };
}
export async function saveNote(note: Omit<Note, 'id' | 'updated_at' | 'subject_name' | 'subject_color' | 'attachments'>) { const r = await database.runAsync('INSERT INTO notes(title,content_json,folder_id,subject_id,updated_at) VALUES(?,?,?,?,?)', [note.title, note.content_json, note.folder_id, note.subject_id, now()]); return r.lastInsertRowId; }
export async function updateNote(id: number, title: string, content: string) { await database.runAsync('UPDATE notes SET title=?,content_json=?,updated_at=? WHERE id=?', [title, content, now(), id]); }
export async function deleteNote(id: number) {
  await database.withTransactionAsync(async () => {
    await database.runAsync('DELETE FROM attachments WHERE note_id=?', [id]);
    await database.runAsync('DELETE FROM notes WHERE id=?', [id]);
  });
}
export async function getAttachments(noteId: number) { return database.getAllAsync<Attachment>('SELECT * FROM attachments WHERE note_id=? ORDER BY id', [noteId]); }
export async function getAllAttachments() { return database.getAllAsync<Attachment>('SELECT * FROM attachments ORDER BY id'); }
export async function saveAttachment(attachment: Omit<Attachment, 'id' | 'created_at'>) { const r = await database.runAsync('INSERT INTO attachments(note_id,file_path,file_type,original_filename,file_size,created_at) VALUES(?,?,?,?,?,?)', [attachment.note_id, attachment.file_path, attachment.file_type, attachment.original_filename, attachment.file_size, now()]); return r.lastInsertRowId; }
export async function deleteAttachment(id: number) { await database.runAsync('DELETE FROM attachments WHERE id=?', [id]); }
export async function getSources(subjectId?: number) { return database.getAllAsync<AiSource & { subject_name: string }>(`SELECT a.*,s.name subject_name FROM ai_sources a JOIN subjects s ON s.id=a.subject_id ${subjectId ? 'WHERE a.subject_id=?' : ''} ORDER BY a.created_at DESC`, subjectId ? [subjectId] : []); }
export async function saveSource(subjectId: number, rawText: string) { await database.runAsync('INSERT INTO ai_sources(subject_id,raw_text,created_at) VALUES(?,?,?)', [subjectId, rawText, now()]); }

export async function getTodayAttendance(dayOfWeek: number, date: string) { return database.getAllAsync<TodayAttendance>(`SELECT sub.*,ts.id timetable_slot_id,ts.start_time,ts.end_time,ts.room,a.status attendance_status FROM timetable_slots ts JOIN subjects sub ON sub.id=ts.subject_id LEFT JOIN attendance a ON a.timetable_slot_id=ts.id AND a.date=? WHERE ts.day_of_week=? ORDER BY ts.start_time`, [date, dayOfWeek]); }
export async function markAttendance(date: string, subjectId: number, timetableSlotId: number, status: AttendanceStatus) { const stamp = now(); await database.runAsync('INSERT INTO attendance(date,subject_id,timetable_slot_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(date,timetable_slot_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at', [date, subjectId, timetableSlotId, status, stamp, stamp]); }
export async function getAttendanceSummaries() { return database.getAllAsync<AttendanceSummary>(`SELECT s.*,COALESCE(SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END),0) present_count,COALESCE(SUM(CASE WHEN a.status='absent' THEN 1 ELSE 0 END),0) absent_count,COALESCE(SUM(CASE WHEN a.status='cancelled' THEN 1 ELSE 0 END),0) cancelled_count,COALESCE(SUM(CASE WHEN a.status IN ('present','absent') THEN 1 ELSE 0 END),0) total_count,CASE WHEN SUM(CASE WHEN a.status IN ('present','absent') THEN 1 ELSE 0 END)>0 THEN ROUND(100.0*SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END)/SUM(CASE WHEN a.status IN ('present','absent') THEN 1 ELSE 0 END),1) ELSE NULL END percentage FROM subjects s LEFT JOIN attendance a ON a.subject_id=s.id GROUP BY s.id ORDER BY percentage IS NULL,percentage ASC,s.name`); }

export async function getSemesters() { return database.getAllAsync<Semester>(`SELECT se.*,COALESCE(SUM(ss.credit_hours),0) total_credits,CASE WHEN SUM(ss.credit_hours)>0 THEN SUM(ss.credit_hours*ss.grade_points)/SUM(ss.credit_hours) ELSE 0 END gpa FROM semesters se LEFT JOIN semester_subjects ss ON ss.semester_id=se.id AND ss.grade_kind='actual' GROUP BY se.id ORDER BY se.id DESC`); }
export async function addSemester(name: string) { const r = await database.runAsync('INSERT INTO semesters(name,created_at) VALUES(?,?)', [name.trim(), now()]); return r.lastInsertRowId; }
export async function deleteSemester(id: number) { await database.runAsync('DELETE FROM semesters WHERE id=?', [id]); }
export async function getSemesterSubjects(semesterId: number) { return database.getAllAsync<SemesterSubject>('SELECT * FROM semester_subjects WHERE semester_id=? ORDER BY id', [semesterId]); }
export async function addSemesterSubject(entry: Omit<SemesterSubject, 'id' | 'grade_points'>) { const points = gradePoints[entry.grade]; const r = await database.runAsync('INSERT INTO semester_subjects(semester_id,subject_id,subject_name,credit_hours,grade,grade_points,grade_kind) VALUES(?,?,?,?,?,?,?)', [entry.semester_id, entry.subject_id, entry.subject_name.trim(), entry.credit_hours, entry.grade, points, entry.grade_kind]); return r.lastInsertRowId; }
export async function updateSemesterSubject(id: number, subjectName: string, creditHours: number, grade: LetterGrade, gradeKind: GradeKind) { await database.runAsync('UPDATE semester_subjects SET subject_name=?,credit_hours=?,grade=?,grade_points=?,grade_kind=? WHERE id=?', [subjectName.trim(), creditHours, grade, gradePoints[grade], gradeKind, id]); }
export async function deleteSemesterSubject(id: number) { await database.runAsync('DELETE FROM semester_subjects WHERE id=?', [id]); }
export async function getCgpa() { const row = await database.getFirstAsync<{ cgpa: number; credits: number }>("SELECT CASE WHEN SUM(credit_hours)>0 THEN SUM(credit_hours*grade_points)/SUM(credit_hours) ELSE 0 END cgpa,COALESCE(SUM(credit_hours),0) credits FROM semester_subjects WHERE grade_kind='actual'"); return row ?? { cgpa: 0, credits: 0 }; }
export async function importSemesterSubjects(semesterId: number, rows: { subject_name: string; credit_hours: number; grade: LetterGrade; grade_kind: GradeKind }[]) { await database.withTransactionAsync(async () => { for (const row of rows) { const subject = await findSubjectByName(row.subject_name); await addSemesterSubject({ semester_id: semesterId, subject_id: subject?.id ?? null, subject_name: row.subject_name, credit_hours: row.credit_hours, grade: row.grade, grade_kind: row.grade_kind }); } }); }

export async function saveFlashcards(cards: FlashcardDraft[], subjectId: number | null, noteId: number | null) { await database.withTransactionAsync(async () => { for (const card of cards) await database.runAsync('INSERT INTO flashcards(subject_id,note_id,front,back,created_at) VALUES(?,?,?,?,?)', [subjectId, noteId, card.front.trim(), card.back.trim(), now()]); }); }
export async function getFlashcardGroups() { return database.getAllAsync<FlashcardGroup>(`SELECT f.subject_id,COALESCE(s.name,'General') subject_name,COUNT(*) card_count,SUM(f.correct_count) correct_count,SUM(f.incorrect_count) incorrect_count FROM flashcards f LEFT JOIN subjects s ON s.id=f.subject_id GROUP BY f.subject_id ORDER BY s.name`); }
export async function getFlashcards(subjectId: number | null) { return database.getAllAsync<Flashcard>(`SELECT f.*,s.name subject_name,n.title note_title FROM flashcards f LEFT JOIN subjects s ON s.id=f.subject_id LEFT JOIN notes n ON n.id=f.note_id WHERE ${subjectId === null ? 'f.subject_id IS NULL' : 'f.subject_id=?'} ORDER BY f.id`, subjectId === null ? [] : [subjectId]); }
export async function recordFlashcardReview(id: number, correct: boolean) { await database.runAsync(`UPDATE flashcards SET ${correct ? 'correct_count=correct_count+1' : 'incorrect_count=incorrect_count+1'} WHERE id=?`, [id]); }
export async function deleteFlashcard(id: number) { await database.runAsync('DELETE FROM flashcards WHERE id=?', [id]); }

const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export async function getExams() { return database.getAllAsync<Exam>('SELECT e.*,s.name subject_name,s.color subject_color FROM exams e JOIN subjects s ON s.id=e.subject_id ORDER BY e.exam_at'); }
export async function addExam(subjectId:number,examAt:string,examType:ExamType,topics:string){const r=await database.runAsync('INSERT INTO exams(subject_id,exam_at,exam_type,topics,created_at) VALUES(?,?,?,?,?)',[subjectId,examAt,examType,topics.trim(),now()]);await regenerateStudyPlan();return r.lastInsertRowId}
export async function deleteExam(id:number){await database.runAsync('DELETE FROM exams WHERE id=?',[id]);await regenerateStudyPlan()}
export async function regenerateStudyPlan(){const exams=await getExams();const today=new Date();today.setHours(0,0,0,0);await database.withTransactionAsync(async()=>{await database.runAsync('DELETE FROM study_plan_items WHERE done=0');for(const exam of exams){const end=new Date(exam.exam_at);end.setHours(0,0,0,0);const days=Math.ceil((end.getTime()-today.getTime())/86400000);if(days<=0)continue;const topics=exam.topics.split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean);for(let offset=0;offset<days;offset++){const day=new Date(today);day.setDate(day.getDate()+offset);const topic=topics.length?topics[Math.min(topics.length-1,Math.floor(offset*topics.length/days))]??`Revise ${exam.subject_name??'subject'}`:`Revise ${exam.subject_name??'subject'}`;await database.runAsync('INSERT OR IGNORE INTO study_plan_items(exam_id,subject_id,plan_date,topic) VALUES(?,?,?,?)',[exam.id,exam.subject_id,dateKey(day),topic])}}})}
export async function getStudyPlan(date?:string){return database.getAllAsync<StudyPlanItem>('SELECT p.*,e.exam_type,e.exam_at,s.name subject_name FROM study_plan_items p JOIN exams e ON e.id=p.exam_id JOIN subjects s ON s.id=p.subject_id WHERE p.plan_date=? ORDER BY e.exam_at',[date??dateKey(new Date())])}
export async function setStudyPlanDone(id:number,done:boolean){await database.runAsync('UPDATE study_plan_items SET done=? WHERE id=?',[done?1:0,id])}
export async function getRecurringTopics(subjectId?:number){return database.getAllAsync<RecurringTopic>(`SELECT r.*,s.name subject_name FROM recurring_topics r JOIN subjects s ON s.id=r.subject_id ${subjectId?'WHERE r.subject_id=?':''} ORDER BY r.frequency DESC,r.topic`,subjectId?[subjectId]:[])}
export async function addRecurringTopic(subjectId:number,topic:string,frequency:number,notes:string){return database.runAsync('INSERT INTO recurring_topics(subject_id,topic,frequency,notes) VALUES(?,?,?,?)',[subjectId,topic.trim(),frequency,notes.trim()||null])}
export async function deleteRecurringTopic(id:number){await database.runAsync('DELETE FROM recurring_topics WHERE id=?',[id])}

export async function addExpense(amountMinor:number,category:string,note:string,spentOn:string){return database.runAsync('INSERT INTO expenses(amount_minor,category,note,spent_on,created_at) VALUES(?,?,?,?,?)',[amountMinor,category,note.trim()||null,spentOn,now()])}
export async function getExpenses(){return database.getAllAsync<Expense>('SELECT * FROM expenses ORDER BY spent_on DESC,id DESC')}
export async function deleteExpense(id:number){await database.runAsync('DELETE FROM expenses WHERE id=?',[id])}
export async function getExpenseSummary(from:string,to:string){return database.getAllAsync<ExpenseSummary>('SELECT category,SUM(amount_minor) total_minor FROM expenses WHERE spent_on BETWEEN ? AND ? GROUP BY category ORDER BY total_minor DESC',[from,to])}
export async function getExpenseTotal(from:string,to:string){const row=await database.getFirstAsync<{total:number}>('SELECT COALESCE(SUM(amount_minor),0) total FROM expenses WHERE spent_on BETWEEN ? AND ?',[from,to]);return row?.total??0}

export async function addGroupProject(title:string,subjectId:number|null,dueAt:string|null,members:string){const r=await database.runAsync('INSERT INTO group_projects(title,subject_id,due_at,members,created_at) VALUES(?,?,?,?,?)',[title.trim(),subjectId,dueAt,members.trim()||null,now()]);return r.lastInsertRowId}
export async function getGroupProjects(){return database.getAllAsync<GroupProject>(`SELECT p.*,s.name subject_name,COUNT(i.id) item_count,COALESCE(SUM(i.done),0) done_count FROM group_projects p LEFT JOIN subjects s ON s.id=p.subject_id LEFT JOIN group_project_items i ON i.project_id=p.id GROUP BY p.id ORDER BY p.due_at IS NULL,p.due_at`)}
export async function deleteGroupProject(id:number){await database.runAsync('DELETE FROM group_projects WHERE id=?',[id])}
export async function getProjectItems(projectId:number){return database.getAllAsync<GroupProjectItem>('SELECT * FROM group_project_items WHERE project_id=? ORDER BY id',[projectId])}
export async function addProjectItem(projectId:number,title:string){return database.runAsync('INSERT INTO group_project_items(project_id,title) VALUES(?,?)',[projectId,title.trim()])}
export async function setProjectItemDone(id:number,done:boolean){await database.runAsync('UPDATE group_project_items SET done=? WHERE id=?',[done?1:0,id])}
export async function deleteProjectItem(id:number){await database.runAsync('DELETE FROM group_project_items WHERE id=?',[id])}

export async function getSubjectContacts(){return database.getAllAsync<SubjectContact>('SELECT c.*,s.name subject_name FROM subject_contacts c JOIN subjects s ON s.id=c.subject_id ORDER BY s.name')}
export async function saveSubjectContact(contact:Omit<SubjectContact,'id'|'subject_name'>){await database.runAsync('INSERT INTO subject_contacts(subject_id,teacher_name,office_hours,phone,email,notes) VALUES(?,?,?,?,?,?) ON CONFLICT(subject_id) DO UPDATE SET teacher_name=excluded.teacher_name,office_hours=excluded.office_hours,phone=excluded.phone,email=excluded.email,notes=excluded.notes',[contact.subject_id,contact.teacher_name.trim(),contact.office_hours,contact.phone,contact.email,contact.notes])}
export async function deleteSubjectContact(id:number){await database.runAsync('DELETE FROM subject_contacts WHERE id=?',[id])}
export async function getCampusReminderTasks(){return database.getAllAsync<Task>("SELECT t.*,s.name subject_name FROM tasks t LEFT JOIN subjects s ON s.id=t.subject_id WHERE t.campus_reminder=1 AND t.status!='done' ORDER BY t.due_at")}
export async function getWeeklyOverview(){const start=new Date();start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+7);const [tasks,exams,attendance]=await Promise.all([database.getFirstAsync<{count:number}>("SELECT COUNT(*) count FROM tasks WHERE status!='done' AND type IN ('assignment','quiz') AND due_at>=? AND due_at<?",[start.toISOString(),end.toISOString()]),database.getFirstAsync<{count:number}>('SELECT COUNT(*) count FROM exams WHERE exam_at>=? AND exam_at<?',[start.toISOString(),end.toISOString()]),database.getFirstAsync<{average:number|null}>("SELECT AVG(subject_pct) average FROM (SELECT 100.0*SUM(CASE WHEN status='present' THEN 1 ELSE 0 END)/NULLIF(SUM(CASE WHEN status IN ('present','absent') THEN 1 ELSE 0 END),0) subject_pct FROM attendance WHERE date=? GROUP BY subject_id)",[dateKey(start)])]);return {dueCount:tasks?.count??0,examCount:exams?.count??0,attendanceAverage:attendance?.average??null}}

export async function exportDatabase() { const [subjects, slots, folders, tasks, notes, sources, attendance, semesters, semesterSubjects, flashcards, exams, studyPlanItems, recurringTopics, expenses, groupProjects, groupProjectItems, subjectContacts, settings, attachments] = await Promise.all([getSubjects(), getSlots(), database.getAllAsync('SELECT * FROM folders'), getTasks(), getNotes(), getSources(), database.getAllAsync('SELECT * FROM attendance'), database.getAllAsync('SELECT * FROM semesters'), database.getAllAsync('SELECT * FROM semester_subjects'), database.getAllAsync('SELECT * FROM flashcards'), database.getAllAsync('SELECT * FROM exams'), database.getAllAsync('SELECT * FROM study_plan_items'), database.getAllAsync('SELECT * FROM recurring_topics'), database.getAllAsync('SELECT * FROM expenses'), database.getAllAsync('SELECT * FROM group_projects'), database.getAllAsync('SELECT * FROM group_project_items'), database.getAllAsync('SELECT * FROM subject_contacts'), database.getAllAsync('SELECT * FROM settings'), getAllAttachments()]); return JSON.stringify({ version: 5, exportedAt: now(), subjects, slots, folders, tasks, notes, sources, attendance, semesters, semesterSubjects, flashcards, exams, studyPlanItems, recurringTopics, expenses, groupProjects, groupProjectItems, subjectContacts, settings, attachments }, null, 2); }

type BackupFolder = { id: number; name: string; parent_id: number | null; created_at: string };
type Backup = { version?:number; subjects?: Subject[]; slots?: Slot[]; folders?: BackupFolder[]; tasks?: Task[]; notes?: Note[]; sources?: AiSource[]; attendance?: { id:number; date:string; subject_id:number; timetable_slot_id:number|null; status:AttendanceStatus; created_at:string; updated_at:string }[]; semesters?: Semester[]; semesterSubjects?: SemesterSubject[]; flashcards?: Flashcard[]; exams?: Exam[]; studyPlanItems?: StudyPlanItem[]; recurringTopics?: RecurringTopic[]; expenses?: Expense[]; groupProjects?: GroupProject[]; groupProjectItems?: GroupProjectItem[]; subjectContacts?: SubjectContact[]; settings?: {key:string;value:string}[]; attachments?: Attachment[] };
export async function restoreDatabase(backupText: string) {
  const b = JSON.parse(backupText) as Backup;
  if (![b.subjects,b.slots,b.tasks,b.notes,b.sources].every(Array.isArray)) throw new Error('This is not a valid StudyHub backup.');
  if (b.folders && (!Array.isArray(b.folders) || b.folders.some((x) => !Number.isInteger(x.id) || typeof x.name !== 'string' || (x.parent_id !== null && !Number.isInteger(x.parent_id)) || typeof x.created_at !== 'string'))) throw new Error('The folder backup data is invalid.');
  if (b.attendance && (!Array.isArray(b.attendance) || b.attendance.some((x) => !Number.isInteger(x.id) || !Number.isInteger(x.subject_id) || (x.timetable_slot_id !== null && !Number.isInteger(x.timetable_slot_id)) || !['present','absent','cancelled'].includes(x.status)))) throw new Error('The attendance backup data is invalid.');
  if (b.semesters && (!Array.isArray(b.semesters) || b.semesters.some((x) => !Number.isInteger(x.id) || typeof x.name !== 'string'))) throw new Error('The semester backup data is invalid.');
  if (b.semesterSubjects && (!Array.isArray(b.semesterSubjects) || b.semesterSubjects.some((x) => !Number.isInteger(x.id) || !(x.grade in gradePoints) || !['actual','expected'].includes(x.grade_kind) || !Number.isFinite(x.credit_hours) || x.credit_hours <= 0))) throw new Error('The grade backup data is invalid.');
  if (b.flashcards && (!Array.isArray(b.flashcards) || b.flashcards.some((x) => !Number.isInteger(x.id) || typeof x.front !== 'string' || typeof x.back !== 'string'))) throw new Error('The flashcard backup data is invalid.');
  if (b.version && ![1,2,3,4,5].includes(b.version)) throw new Error('This backup version is not supported.');
  if (b.exams?.some(x=>!Number.isInteger(x.id)||!Number.isInteger(x.subject_id)||!['quiz','midterm','final'].includes(x.exam_type)||Number.isNaN(Date.parse(x.exam_at)))) throw new Error('The exam backup data is invalid.');
  if (b.studyPlanItems?.some(x=>!Number.isInteger(x.id)||!Number.isInteger(x.exam_id)||!Number.isInteger(x.subject_id)||![0,1].includes(x.done)||!/^\d{4}-\d{2}-\d{2}$/.test(x.plan_date))) throw new Error('The study-plan backup data is invalid.');
  if (b.recurringTopics?.some(x=>!Number.isInteger(x.id)||!Number.isInteger(x.subject_id)||!Number.isInteger(x.frequency)||x.frequency<1||!x.topic)) throw new Error('The recurring-topic backup data is invalid.');
  if (b.expenses?.some(x=>!Number.isInteger(x.id)||!Number.isInteger(x.amount_minor)||x.amount_minor<0||!x.category)) throw new Error('The expense backup data is invalid.');
  if (b.groupProjects?.some(x=>!Number.isInteger(x.id)||!x.title)) throw new Error('The project backup data is invalid.');
  if (b.groupProjectItems?.some(x=>!Number.isInteger(x.id)||!Number.isInteger(x.project_id)||![0,1].includes(x.done)||!x.title)) throw new Error('The project checklist backup data is invalid.');
  if (b.subjectContacts?.some(x=>!Number.isInteger(x.id)||!Number.isInteger(x.subject_id)||!x.teacher_name)) throw new Error('The contact backup data is invalid.');
  if (b.settings?.some(x=>typeof x.key!=='string'||typeof x.value!=='string')) throw new Error('The settings backup data is invalid.');
  if (b.attachments && (!Array.isArray(b.attachments) || b.attachments.some(x=>!Number.isInteger(x.id)||!Number.isInteger(x.note_id)||!x.file_path||!x.original_filename))) throw new Error('The attachments backup data is invalid.');
  await database.withTransactionAsync(async () => {
    await database.execAsync("DELETE FROM attachments;DELETE FROM subject_contacts;DELETE FROM group_project_items;DELETE FROM group_projects;DELETE FROM expenses;DELETE FROM recurring_topics;DELETE FROM study_plan_items;DELETE FROM exams;DELETE FROM flashcards;DELETE FROM semester_subjects;DELETE FROM semesters;DELETE FROM attendance;DELETE FROM ai_sources;DELETE FROM notes;DELETE FROM folders;DELETE FROM tasks;DELETE FROM timetable_slots;DELETE FROM subjects;DELETE FROM settings WHERE key!='onboarded';");
    for (const x of b.subjects!) await database.runAsync('INSERT INTO subjects(id,name,code,color,teacher) VALUES(?,?,?,?,?)', [x.id,x.name,x.code,x.color,x.teacher]);
    for (const x of b.slots!) await database.runAsync('INSERT INTO timetable_slots(id,subject_id,day_of_week,start_time,end_time,room,teacher) VALUES(?,?,?,?,?,?,?)', [x.id,x.subject_id,x.day_of_week,x.start_time,x.end_time,x.room,x.teacher ?? null]);
    for (const x of b.folders ?? []) await database.runAsync('INSERT INTO folders(id,name,parent_id,created_at) VALUES(?,?,?,?)', [x.id,x.name,x.parent_id,x.created_at]);
    for (const x of b.tasks!) await database.runAsync('INSERT INTO tasks(id,title,type,subject_id,due_at,priority,status,notes,recurring,campus_reminder,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', [x.id,x.title,x.type,x.subject_id,x.due_at,x.priority,x.status,x.notes,x.recurring,x.campus_reminder??0,x.created_at??now()]);
    for (const x of b.notes!) await database.runAsync('INSERT INTO notes(id,title,content_json,folder_id,subject_id,updated_at) VALUES(?,?,?,?,?,?)', [x.id,x.title,x.content_json,b.folders ? x.folder_id : null,x.subject_id,x.updated_at]);
    for (const x of b.attachments ?? []) await database.runAsync('INSERT INTO attachments(id,note_id,file_path,file_type,original_filename,file_size,created_at) VALUES(?,?,?,?,?,?,?)', [x.id,x.note_id,x.file_path,x.file_type,x.original_filename,x.file_size??0,x.created_at??now()]);
    for (const x of b.sources!) await database.runAsync('INSERT INTO ai_sources(id,subject_id,raw_text,created_at) VALUES(?,?,?,?)', [x.id,x.subject_id,x.raw_text,x.created_at]);
    for (const x of b.attendance ?? []) await database.runAsync('INSERT INTO attendance(id,date,subject_id,timetable_slot_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', [x.id,x.date,x.subject_id,x.timetable_slot_id,x.status,x.created_at,x.updated_at]);
    for (const x of b.semesters ?? []) await database.runAsync('INSERT INTO semesters(id,name,created_at) VALUES(?,?,?)', [x.id,x.name,x.created_at]);
    for (const x of b.semesterSubjects ?? []) await database.runAsync('INSERT INTO semester_subjects(id,semester_id,subject_id,subject_name,credit_hours,grade,grade_points,grade_kind) VALUES(?,?,?,?,?,?,?,?)', [x.id,x.semester_id,x.subject_id,x.subject_name,x.credit_hours,x.grade,gradePoints[x.grade],x.grade_kind]);
    for (const x of b.flashcards ?? []) await database.runAsync('INSERT INTO flashcards(id,subject_id,note_id,front,back,correct_count,incorrect_count,created_at) VALUES(?,?,?,?,?,?,?,?)', [x.id,x.subject_id,x.note_id,x.front,x.back,x.correct_count,x.incorrect_count,x.created_at]);
    for (const x of b.exams ?? []) await database.runAsync('INSERT INTO exams(id,subject_id,exam_at,exam_type,topics,created_at) VALUES(?,?,?,?,?,?)',[x.id,x.subject_id,x.exam_at,x.exam_type,x.topics,x.created_at]);
    for (const x of b.studyPlanItems ?? []) await database.runAsync('INSERT INTO study_plan_items(id,exam_id,subject_id,plan_date,topic,done) VALUES(?,?,?,?,?,?)',[x.id,x.exam_id,x.subject_id,x.plan_date,x.topic,x.done]);
    for (const x of b.recurringTopics ?? []) await database.runAsync('INSERT INTO recurring_topics(id,subject_id,topic,frequency,notes) VALUES(?,?,?,?,?)',[x.id,x.subject_id,x.topic,x.frequency,x.notes]);
    for (const x of b.expenses ?? []) await database.runAsync('INSERT INTO expenses(id,amount_minor,category,note,spent_on,created_at) VALUES(?,?,?,?,?,?)',[x.id,x.amount_minor,x.category,x.note,x.spent_on,x.created_at]);
    for (const x of b.groupProjects ?? []) await database.runAsync('INSERT INTO group_projects(id,title,subject_id,due_at,members,created_at) VALUES(?,?,?,?,?,?)',[x.id,x.title,x.subject_id,x.due_at,x.members,x.created_at]);
    for (const x of b.groupProjectItems ?? []) await database.runAsync('INSERT INTO group_project_items(id,project_id,title,done) VALUES(?,?,?,?)',[x.id,x.project_id,x.title,x.done]);
    for (const x of b.subjectContacts ?? []) await database.runAsync('INSERT INTO subject_contacts(id,subject_id,teacher_name,office_hours,phone,email,notes) VALUES(?,?,?,?,?,?,?)',[x.id,x.subject_id,x.teacher_name,x.office_hours,x.phone,x.email,x.notes]);
    for (const x of b.settings ?? []) if(!x.key.includes('api_key')) await database.runAsync('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[x.key,x.value]);
  });
}

export { database };
