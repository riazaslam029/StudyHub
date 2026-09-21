import { ColorSchemeName } from 'react-native';

export const palette = {
  clay: '#C95732', clayDark: '#A93F20', saffron: '#E8A838', ink: '#202423', moss: '#31715F',
  paper: '#FAF8F3', mist: '#F1EEE6', line: '#E4DED2', muted: '#716F69', white: '#FFFFFF',
  night: '#151A19', nightRaised: '#202725', nightSoft: '#29312E', nightLine: '#39413E', nightText: '#F5F1E8',
  danger: '#B83E35', success: '#31715F'
} as const;

export type AppTheme = ReturnType<typeof makeTheme>;
export function makeTheme(scheme: ColorSchemeName | 'light' | 'dark' = 'light') {
  const dark = scheme === 'dark';
  return {
    dark,
    colors: {
      background: dark ? palette.night : palette.paper,
      surface: dark ? palette.nightRaised : palette.white,
      surfaceSoft: dark ? palette.nightSoft : palette.mist,
      text: dark ? palette.nightText : palette.ink,
      muted: dark ? '#B6B6AE' : palette.muted,
      border: dark ? palette.nightLine : palette.line,
      accent: palette.clay,
      accentStrong: palette.clayDark,
      accentSoft: dark ? '#543329' : '#F8E5DC',
      positive: palette.moss,
      warning: palette.saffron,
      danger: palette.danger,
    },
    spacing: { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48 },
    radius: { sm: 10, md: 16, lg: 24, pill: 999 },
    type: { display: 'System', body: 'System' },
  };
}
