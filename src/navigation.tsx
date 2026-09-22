import React from 'react';
import { NavigationContainer, DefaultTheme, Theme, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Bot, CheckSquare, House, NotebookTabs, Settings, TrendingUp } from 'lucide-react-native';
import { AiScreen } from './screens/AiScreen';
import { AttendanceScreen } from './screens/AttendanceScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { FlashcardsScreen } from './screens/FlashcardsScreen';
import { GpaScreen } from './screens/GpaScreen';
import { NotesScreen } from './screens/NotesScreen';
import { ProgressScreen } from './screens/ProgressScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TasksScreen } from './screens/TasksScreen';
import { TimetableReviewScreen } from './screens/TimetableReviewScreen';
import { TimetableScreen } from './screens/TimetableScreen';
import { TranscriptReviewScreen } from './screens/TranscriptReviewScreen';
import { ContactsScreen } from './screens/ContactsScreen';
import { ExamPrepScreen } from './screens/ExamPrepScreen';
import { ExpensesScreen } from './screens/ExpensesScreen';
import { MockQuizScreen } from './screens/MockQuizScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { WeeklyOverviewScreen } from './screens/WeeklyOverviewScreen';
import { AppTheme } from './theme';

const Tabs=createBottomTabNavigator();const Planner=createNativeStackNavigator();const Progress=createNativeStackNavigator();
export const navigationRef=createNavigationContainerRef<any>();
function PlannerStack({theme}:{theme:AppTheme}){return <Planner.Navigator screenOptions={{headerShown:false}}><Planner.Screen name="Tasks">{props=><TasksScreen {...props} theme={theme}/>}</Planner.Screen><Planner.Screen name="Timetable">{props=><TimetableScreen {...props} theme={theme}/>}</Planner.Screen><Planner.Screen name="TimetableReview">{props=><TimetableReviewScreen {...props} theme={theme}/>}</Planner.Screen></Planner.Navigator>}
function ProgressStack({theme}:{theme:AppTheme}){return <Progress.Navigator screenOptions={{headerShown:false}}><Progress.Screen name="ProgressHome">{props=><ProgressScreen {...props} theme={theme}/>}</Progress.Screen><Progress.Screen name="Attendance">{props=><AttendanceScreen {...props} theme={theme}/>}</Progress.Screen><Progress.Screen name="GPA">{props=><GpaScreen {...props} theme={theme}/>}</Progress.Screen><Progress.Screen name="TranscriptReview">{props=><TranscriptReviewScreen {...props} theme={theme}/>}</Progress.Screen><Progress.Screen name="Flashcards">{props=><FlashcardsScreen {...props} theme={theme}/>}</Progress.Screen><Progress.Screen name="ExamPrep">{props=><ExamPrepScreen {...props} theme={theme}/>}</Progress.Screen><Progress.Screen name="MockQuiz">{props=><MockQuizScreen {...props} theme={theme}/>}</Progress.Screen><Progress.Screen name="Expenses">{props=><ExpensesScreen {...props} theme={theme}/>}</Progress.Screen><Progress.Screen name="Projects">{props=><ProjectsScreen {...props} theme={theme}/>}</Progress.Screen><Progress.Screen name="Contacts">{props=><ContactsScreen {...props} theme={theme}/>}</Progress.Screen><Progress.Screen name="WeeklyOverview">{props=><WeeklyOverviewScreen {...props} theme={theme}/>}</Progress.Screen></Progress.Navigator>}
export function StudyHubNavigator({theme}:{theme:AppTheme}){const navTheme:Theme={...DefaultTheme,colors:{...DefaultTheme.colors,background:theme.colors.background,card:theme.colors.surface,text:theme.colors.text,border:theme.colors.border,primary:theme.colors.accent,notification:theme.colors.accent}};const icon=(Icon:typeof House)=>({color,size}:{color:string;size:number})=><Icon color={color} size={size}/>;return <NavigationContainer ref={navigationRef} theme={navTheme}><Tabs.Navigator screenOptions={{headerShown:false,tabBarStyle:{backgroundColor:theme.colors.surface,borderTopColor:theme.colors.border,height:66,paddingTop:6},tabBarActiveTintColor:theme.colors.accent,tabBarInactiveTintColor:theme.colors.muted,tabBarLabelStyle:{fontWeight:'700',fontSize:10}}}><Tabs.Screen name="Home" options={{tabBarIcon:icon(House)}}>{props=><DashboardScreen {...props} theme={theme}/>}</Tabs.Screen><Tabs.Screen name="Planner" options={{tabBarIcon:icon(CheckSquare)}}>{()=><PlannerStack theme={theme}/>}</Tabs.Screen><Tabs.Screen name="Notes" options={{tabBarIcon:icon(NotebookTabs)}}>{props=><NotesScreen {...props} theme={theme}/>}</Tabs.Screen><Tabs.Screen name="AI" options={{tabBarIcon:icon(Bot)}}>{()=><AiScreen theme={theme}/>}</Tabs.Screen><Tabs.Screen name="Progress" options={{tabBarIcon:icon(TrendingUp)}}>{()=><ProgressStack theme={theme}/>}</Tabs.Screen><Tabs.Screen name="Settings" options={{tabBarIcon:icon(Settings)}}>{()=><SettingsScreen theme={theme}/>}</Tabs.Screen></Tabs.Navigator></NavigationContainer>}
