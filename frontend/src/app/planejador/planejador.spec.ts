import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { LocalizacaoService } from '../core/localizacao.service';
import { TrajetoService } from '../core/trajeto.service';
import { Trajeto, Viagem } from '../core/trajeto.models';
import { horarioNatal, Planejador } from './planejador';

const origem = { nome: 'Origem', lat: -5.8, lng: -35.2 };
const destino = { nome: 'Destino', lat: -5.85, lng: -35.2 };
const viagem: Viagem = {
  inicio: '2026-10-08T11:00:00Z',
  fim: '2026-10-08T11:05:00Z',
  duracaoSegundos: 300,
  caminhadaMetros: 350,
  trechos: [
    {
      modo: 'WALK',
      inicio: '2026-10-08T11:00:00Z',
      fim: '2026-10-08T11:05:00Z',
      duracaoSegundos: 300,
      metros: 350,
      linha: null,
      letreiro: null,
      partida: origem,
      chegada: destino,
      tracado: [
        [-5.8, -35.2],
        [-5.85, -35.2],
      ],
    },
  ],
};

describe('Planejador', () => {
  const planejar = vi.fn();
  const pedir = vi.fn();
  beforeEach(async () => {
    planejar.mockReset().mockResolvedValue({ consultadoEm: viagem.inicio, viagens: [viagem] });
    pedir.mockReset().mockResolvedValue('Localização bloqueada.');
    await TestBed.configureTestingModule({
      imports: [Planejador],
      providers: [
        { provide: TrajetoService, useValue: { planejar } },
        {
          provide: LocalizacaoService,
          useValue: { pedir, buscando: signal(false), posicao: signal(null) },
        },
      ],
    }).compileComponents();
  });

  it('usa hora de Natal e só busca depois de definir os dois pontos', async () => {
    expect(horarioNatal(Date.parse('2026-10-08T11:00:00Z'))).toBe('2026-10-08T08:00');
    const fixture = TestBed.createComponent(Planejador);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const buscar = el.querySelector<HTMLButtonElement>('[type=submit]')!;
    expect(buscar.disabled).toBe(true);
    fixture.componentInstance.definirPonto('origem', origem);
    fixture.componentInstance.definirPonto('destino', destino);
    await fixture.whenStable();
    expect(buscar.disabled).toBe(false);
    buscar.click();
    await fixture.whenStable();
    expect(planejar).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('apenas trajetos a pé');
    expect(el.textContent).toContain('08:05');
  });

  it('permite escolher no mapa quando o GPS é recusado', async () => {
    const fixture = TestBed.createComponent(Planejador);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const botao = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Minha localização'),
    )!;
    botao.click();
    await fixture.whenStable();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Localização bloqueada');
    const selecionar = vi.fn();
    fixture.componentInstance.selecaoAlterada.subscribe(selecionar);
    [...el.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Escolher no mapa'))!
      .click();
    expect(selecionar).toHaveBeenCalledWith('origem');
  });

  it('ignora resposta pendente se o passageiro muda o destino', async () => {
    let resolver!: (v: Trajeto) => void;
    planejar.mockImplementationOnce(
      () =>
        new Promise<Trajeto>((r) => {
          resolver = r;
        }),
    );
    const fixture = TestBed.createComponent(Planejador);
    const component = fixture.componentInstance;
    const mostrar = vi.fn();
    component.viagemEscolhida.subscribe(mostrar);
    component.definirPonto('origem', origem);
    component.definirPonto('destino', destino);
    await fixture.whenStable();
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[type=submit]')!
      .click();
    const signal = planejar.mock.calls[0][3] as AbortSignal;
    component.definirPonto('destino', { ...destino, lat: -5.9 });
    expect(signal.aborted).toBe(true);
    resolver({ consultadoEm: viagem.inicio, viagens: [viagem] });
    await fixture.whenStable();
    expect(mostrar).not.toHaveBeenCalledWith(viagem);
    expect((fixture.nativeElement as HTMLElement).querySelector('.resultados')).toBeNull();
  });
});
