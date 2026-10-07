import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  it('mostra a marca, o campo de busca e as abas', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Ônibus');
    expect(el.querySelector('input[aria-label="Número da linha"]')).toBeTruthy();
    expect(el.querySelectorAll('[role="tab"]')).toHaveLength(2);
  });

  it('lista as linhas favoritas salvas', async () => {
    localStorage.setItem('onibus-natal:favoritas', JSON.stringify(['33', '54']));
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click();
    await fixture.whenStable();
    const chips = [...el.querySelectorAll('.chips button')].map((b) => b.textContent?.trim());
    expect(chips).toEqual(['33', '54']);
  });
});
