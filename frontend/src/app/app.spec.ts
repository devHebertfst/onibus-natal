import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { By } from '@angular/platform-browser';
import { Subject } from 'rxjs';
import { Atualizacao, LinhaService } from './core/linha.service';
import { PrevisaoService } from './core/previsao.service';
import { PrevisaoOficial } from './core/linha.models';
import { Mapa } from './mapa/mapa';
import { Planejador } from './planejador/planejador';
import { TrajetoService } from './core/trajeto.service';
import { Viagem } from './core/trajeto.models';
import { CatalogoService } from './core/catalogo.service';

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    history.replaceState(null, '', '/');
    HTMLElement.prototype.scrollIntoView = vi.fn();
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
    vi.spyOn(TestBed.inject(CatalogoService), 'listar').mockResolvedValue([
      { numero: '33', descricoes: ['Planalto / Praia do Meio', 'Planalto / Mãe Luiza'] },
      { numero: '54', descricoes: ['Alecrim / Ponta Negra'] },
      { numero: '73', descricoes: ['Santarém / Ponta Negra'] },
    ]);
  });

  it('mostra a marca e a busca de linhas com rótulo acessível', async () => {
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
    const favoritas = [...el.querySelectorAll('.favoritar-catalogo[aria-pressed="true"]')].map(
      (b) => b.getAttribute('aria-label'),
    );
    expect(favoritas).toEqual([
      'Remover dos favoritos: linha 33',
      'Remover dos favoritos: linha 54',
    ]);
    const linhas = el.querySelector('.catalogo-linhas')!;
    expect(linhas.textContent).toContain('Planalto / Praia do Meio');
    expect(linhas.querySelector('.frota, .escolher, .legenda, app-placa')).toBeNull();
  });

  it('permite alternar os painéis e fechar com Escape sem desmontar o planejador', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('nav button[aria-label="Trajetos"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('app-planejador')).toBeTruthy();
    el.querySelector<HTMLButtonElement>('nav button[aria-label="Favoritas"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('app-planejador')?.closest('[hidden]')).toBeTruthy();
    expect(el.querySelector('.pagina-menu:not([hidden]) .vazio-menu')?.textContent).toContain(
      'Suas linhas ficam aqui',
    );
    expect(el.querySelector('#campo-linha')?.closest('[hidden]')).toBeTruthy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(el.querySelector('main')?.hidden).toBe(true);
    expect(el.querySelector('nav button[aria-current="page"]')).toBeNull();
    el.querySelector<HTMLButtonElement>('nav button[aria-label="Linhas"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('#campo-linha')?.closest('[hidden]')).toBeNull();
  });

  it('fecha pelo botão do menu e pelo X sem alterar o mapa', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const mapa = fixture.debugElement.query(By.directive(Mapa)).componentInstance as Mapa;
    const enquadrar = vi.spyOn(mapa, 'enquadrar');
    const mover = vi.spyOn(mapa, 'enquadrarVarios');
    el.querySelector<HTMLButtonElement>('nav button[aria-label="Linhas"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('main')!.hidden).toBe(true);
    el.querySelector<HTMLButtonElement>('nav button[aria-label="Paradas"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('main')!.hidden).toBe(false);
    el.querySelector<HTMLButtonElement>('button[aria-label="Fechar menu Paradas"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('main')!.hidden).toBe(true);
    expect(enquadrar).not.toHaveBeenCalled();
    expect(mover).not.toHaveBeenCalled();
    expect(fixture.debugElement.query(By.directive(Mapa)).componentInstance).toBe(mapa);
  });

  it('preserva pontos, horário, resultado e camadas do trajeto ao trocar ou fechar menus', async () => {
    const origem = { nome: 'Origem salva', lat: -5.8, lng: -35.2 };
    const destino = { nome: 'Destino salvo', lat: -5.81, lng: -35.2 };
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
            [origem.lat, origem.lng],
            [destino.lat, destino.lng],
          ],
        },
      ],
    };
    vi.spyOn(TestBed.inject(TrajetoService), 'planejar').mockResolvedValue({
      consultadoEm: viagem.inicio,
      viagens: [viagem],
    });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('nav button[aria-label="Trajetos"]')!.click();
    await fixture.whenStable();
    const planejador = fixture.debugElement.query(By.directive(Planejador))
      .componentInstance as Planejador;
    planejador.definirPonto('origem', origem);
    planejador.definirPonto('destino', destino);
    await fixture.whenStable();
    const horario = el.querySelector<HTMLInputElement>('#partida-trajeto')!;
    horario.value = '2026-10-08T08:00';
    horario.dispatchEvent(new Event('change'));
    el.querySelector<HTMLButtonElement>('app-planejador [type="submit"]')!.click();
    await fixture.whenStable();
    const mapa = fixture.debugElement.query(By.directive(Mapa)).componentInstance as Mapa;
    const pontos = mapa.pontosTrajeto();
    const mover = vi.spyOn(mapa, 'enquadrarVarios');
    mover.mockClear();
    el.querySelector<HTMLButtonElement>('nav button[aria-label="Paradas"]')!.click();
    await fixture.whenStable();
    expect(mapa.pontosTrajeto()).toBe(pontos);
    expect(mapa.viagem()).toEqual(viagem);
    el.querySelector<HTMLButtonElement>('nav button[aria-label="Favoritas"]')!.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('nav button[aria-label="Trajetos"]')!.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('button[aria-label="Fechar menu Trajetos"]')!.click();
    await fixture.whenStable();
    expect(mapa.pontosTrajeto()).toBe(pontos);
    el.querySelector<HTMLButtonElement>('nav button[aria-label="Trajetos"]')!.click();
    await fixture.whenStable();
    expect(fixture.debugElement.query(By.directive(Planejador)).componentInstance).toBe(planejador);
    expect(horario.value).toBe('2026-10-08T08:00');
    expect(el.querySelector('app-planejador')?.textContent).toContain('Origem salva');
    expect(el.querySelector('app-planejador')?.textContent).toContain('Destino salvo');
    expect(el.querySelector('app-planejador .resultados')?.textContent).toContain(
      'Trajeto encontrado',
    );
    expect(mover).not.toHaveBeenCalled();
  });

  it('abre uma favorita sem refazer a conexão quando a linha já está acompanhada', async () => {
    localStorage.setItem('onibus-natal:favoritas', JSON.stringify(['33']));
    const atualizacoes = new Subject<Atualizacao>();
    const acompanhar = vi
      .spyOn(TestBed.inject(LinhaService), 'acompanhar')
      .mockReturnValue(atualizacoes);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('.abrir-catalogo')!.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('nav button[aria-label="Favoritas"]')!.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('.abrir-salva')!.click();
    await fixture.whenStable();
    expect(acompanhar).toHaveBeenCalledTimes(1);
    expect(el.querySelector('main')!.hidden).toBe(true);
    expect(el.querySelector('nav button[aria-current="page"]')).toBeNull();
    expect(el.querySelector<HTMLInputElement>('#campo-linha')!.value).toBe('');
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
    expect(el.querySelector('.pagina-menu:not([hidden]) app-placa')).toBeTruthy();
    el.querySelector<HTMLButtonElement>('app-placa .trocar')!.click();
    await fixture.whenStable();
    expect(el.querySelector<HTMLDetailsElement>('.paradas-da-linha')!.open).toBe(true);
    expect(el.querySelector('app-placa')).toBeNull();
    expect(el.querySelector('#titulo-seu-ponto')).toBeTruthy();
  });

  it('filtra por bairro e favorita sem abrir uma conexão ou mover o mapa', async () => {
    const acompanhar = vi.spyOn(TestBed.inject(LinhaService), 'acompanhar');
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const mapa = fixture.debugElement.query(By.directive(Mapa)).componentInstance as Mapa;
    const mover = vi.spyOn(mapa, 'enquadrar');
    const campo = el.querySelector<HTMLInputElement>('#campo-linha')!;
    campo.value = 'mae luiza';
    campo.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(el.querySelectorAll('.abrir-catalogo')).toHaveLength(1);
    expect(el.querySelector('.abrir-catalogo')!.textContent).toContain('Mãe Luiza');
    campo.value = 'santarem';
    campo.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(el.querySelectorAll('.abrir-catalogo')).toHaveLength(1);
    expect(el.querySelector('.abrir-catalogo')!.textContent).toContain('73');
    el.querySelector<HTMLButtonElement>('.favoritar-catalogo')!.click();
    await fixture.whenStable();
    expect(el.querySelector('.favoritar-catalogo')!.getAttribute('aria-pressed')).toBe('true');
    expect(acompanhar).not.toHaveBeenCalled();
    el.querySelector<HTMLButtonElement>('button[aria-label="Limpar busca"]')!.click();
    await fixture.whenStable();
    expect(el.querySelectorAll('.abrir-catalogo')).toHaveLength(3);
    el.querySelector<HTMLButtonElement>('nav button[aria-label="Favoritas"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('.abrir-salva')!.textContent).toContain('Santarém');
    expect(mover).not.toHaveBeenCalled();
  });

  it('fecha ao abrir a linha, mantém a busca e não fecha novamente com atualizações de GPS', async () => {
    const atualizacoes = new Subject<Atualizacao>();
    const acompanhar = vi
      .spyOn(TestBed.inject(LinhaService), 'acompanhar')
      .mockReturnValue(atualizacoes);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const campo = el.querySelector<HTMLInputElement>('#campo-linha')!;
    campo.value = 'Planalto';
    campo.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('.abrir-catalogo')!.click();
    const dados: Atualizacao = {
      tipo: 'dados',
      recebidoEm: Date.now(),
      linha: {
        numero: '33',
        atualizadoEm: new Date().toISOString(),
        desatualizado: false,
        onibus: [],
        itinerarios: [],
      },
    };
    atualizacoes.next(dados);
    await fixture.whenStable();
    expect(el.querySelector('main')!.hidden).toBe(true);
    el.querySelector<HTMLButtonElement>('nav button[aria-label="Linhas"]')!.click();
    await fixture.whenStable();
    expect(campo.value).toBe('Planalto');
    atualizacoes.next(dados);
    await fixture.whenStable();
    expect(el.querySelector('main')!.hidden).toBe(false);
    el.querySelector<HTMLButtonElement>('button[aria-label="Limpar busca"]')!.click();
    await fixture.whenStable();
    expect(acompanhar).toHaveBeenCalledTimes(1);
    expect(el.querySelector('.abrir-linha-atual b')!.textContent).toBe('33');
  });
});
