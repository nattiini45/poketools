import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  legend: 'Sprite-Stil',
  menuLegend: 'Pokémon-Sprites',
  options: {
    site: {
      label: 'Standard der Seite',
      help: 'Folgt dem Standard dieser Seite: {style}.',
    },
    broadcast: {
      label: 'Broadcast-Renders',
      help: 'Hochauflösende Renders. Pokémon ohne eigenes Render zeigen das HOME-Render.',
    },
    home: {
      label: 'HOME-Renders',
      help: '3D-Renders wie in Pokémon HOME.',
    },
    animated: {
      label: 'Animiert',
      help: 'Animierte Kampf-Sprites.',
    },
    pixel: {
      label: 'Pixel',
      help: 'Klassische Pixel-Sprites.',
    },
  },
  previewAlt: 'Vorschau {style}: {species}',
  broadcastUnavailable: 'Auf dieser Seite sind keine Broadcast-Renders eingerichtet, deshalb siehst du die HOME-Renders.',
  saving: 'Wird gespeichert …',
  saved: 'Sprite-Stil gespeichert.',
  saveFailed: 'Dein Sprite-Stil konnte nicht gespeichert werden. Bitte versuche es noch einmal.',
  staleRead: 'Dein gespeicherter Sprite-Stil konnte nicht geladen werden. Die Auswahl unten ist die dieses Browsers, nicht unbedingt die deines Kontos.',
  settings: {
    heading: 'Sprite-Stil',
    descriptionSignedIn: 'Wähle, wie Pokémon auf der ganzen Seite aussehen. Die Auswahl wird in deinem Konto gespeichert.',
  },
});
