import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { By } from '@angular/platform-browser';
import { Subject } from 'rxjs';
import { Atualizacao, LinhaService } from './core/linha.service';
import { PrevisaoService } from './core/previsao.service';
import { PrevisaoOficial } from './core/linha.models';
import { Mapa } from './mapa/mapa';

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

  it('não reaproveita a previsão da parada anterior ao escolher outro ponto', async () => {
    const atualizacoes = new Subject<Atualizacao>();
    const previsoes = new Subject<PrevisaoOficial>();
    vi.spyOn(TestBed.inject(LinhaService), 'acompanhar').mockReturnValue(atualizacoes);
    vi.spyOn(TestBed.inject(PrevisaoService), 'acompanhar').mockReturnValue(previsoes);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const campo = el.querySelector<HTMLInputElement>('#campo-linha')!;
    campo.value = '33';
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    el.querySelector('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    atualizacoes.next({
      tipo: 'dados',
      recebidoEm: Date.now(),
      linha: {
        numero: '33',
        atualizadoEm: new Date().toISOString(),
        desatualizado: false,
        onibus: [],
        itinerarios: [
          {
            codigo: 'IT',
            descricao: 'Planalto / Praia do Meio',
            tracado: [
              [-5.8, -35.2],
              [-5.81, -35.2],
            ],
            paradas: [
              { codigo: 'P1', descricao: 'Rua A', ordem: 1, lat: -5.8, lng: -35.2 },
              { codigo: 'P2', descricao: 'Rua B', ordem: 2, lat: -5.81, lng: -35.2 },
            ],
          },
        ],
      },
    });
    await fixture.whenStable();
    const mapa = fixture.debugElement.query(By.directive(Mapa)).componentInstance as Mapa;
    mapa.pontoClicado.emit('IT|P1');
    await fixture.whenStable();
    previsoes.next({
      itinerario: 'IT',
      parada: 'P1',
      consultadoEm: new Date().toISOString(),
      chegadas: [
        {
          onibus: 'OficialBus',
          aoVivo: true,
          chegaEm: new Date(Date.now() + 5 * 60_000).toISOString(),
          metros: 1000,
          gpsEm: null,
        },
      ],
    });
    await fixture.whenStable();
    expect(el.querySelector('app-placa')?.textContent).toContain('OficialBus');
    mapa.pontoClicado.emit('IT|P2');
    await fixture.whenStable();
    expect(el.querySelector('app-placa')?.textContent).toContain('Rua B');
    expect(el.querySelector('app-placa')?.textContent).not.toContain('OficialBus');
  });
});
