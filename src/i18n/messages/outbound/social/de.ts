import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  testPost: {
    title: 'PokéTools: Test der Social-Integration',
    provider: 'Anbieter: {provider}',
    label: 'Bezeichnung: {label}',
    time: 'Zeit: {time}',
  },
});
