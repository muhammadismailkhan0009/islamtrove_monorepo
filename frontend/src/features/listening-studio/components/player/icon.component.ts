import { Component, Input } from '@angular/core';

const ICON_PATHS: Record<string, string> = {
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z',
  headphones: 'M3 14v-3a9 9 0 0 1 18 0v3 M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-5Zm18 0h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-5Z',
  search: 'm21 21-4.35-4.35 M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z',
  play: 'm8 5 11 7-11 7V5Z',
  pause: 'M8 5v14 M16 5v14',
  back: 'M5 5v14 M19 5 8 12l11 7V5Z',
  forward: 'M19 5v14 M5 5l11 7-11 7V5Z',
  plus: 'M12 5v14 M5 12h14',
  check: 'm5 12 4 4L19 6',
  close: 'M18 6 6 18 M6 6l12 12',
  arrow: 'M5 12h14 m-6-6 6 6-6 6',
  volume: 'M11 5 6 9H2v6h4l5 4V5Zm4 4a5 5 0 0 1 0 6 m3-9a9 9 0 0 1 0 12',
  bookmark: 'M6 4h12v17l-6-4-6 4V4Z',
  layers: 'm12 2 9 5-9 5-9-5 9-5Zm-9 10 9 5 9-5 M3 17l9 5 9-5',
  info: 'M12 17v-5 M12 8h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  chevronDown: 'm6 9 6 6 6-6',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  wave: 'M2 9v6 M6 5v14 M10 8v8 M14 3v18 M18 8v8 M22 6v12',
  languages: 'M5 8h14 M12 3v5 M7 8c.5 6 4 9 7 11 M17 8c-.5 6-4 9-7 11'
};

@Component({
  selector: 'it-icon',
  standalone: true,
  template: '<svg [attr.width]="size" [attr.height]="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="path" /></svg>',
  styles: [':host{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}']
})
export class IconComponent {
  @Input({ required: true }) name = 'book';
  @Input() size = 20;
  get path(): string { return ICON_PATHS[this.name] ?? ICON_PATHS['book']; }
}
