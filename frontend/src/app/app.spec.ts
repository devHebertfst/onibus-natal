import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  it('mostra a marca e o campo da linha com rótulo visível', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Ônibus Natal');
    const label = el.querySelector('label[for="campo-linha"]');
    expect(label?.textContent?.trim()).toBe('Linha');
    expect(el.querySelector('#campo-linha')).toBeTruthy();
    expect(el.querySelector('[role="tab"]')).toBeNull();
  });

  it('lista as linhas favoritas salvas na tela inicial', async () => {
    localStorage.setItem('onibus-natal:favoritas', JSON.stringify(['33', '54']));
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const chips = [...el.querySelectorAll('.chips button')].map((b) => b.textContent?.trim());
    expect(chips).toEqual(['33', '54']);
  });
});
