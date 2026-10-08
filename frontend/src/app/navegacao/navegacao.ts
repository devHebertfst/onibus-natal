import { Component, input, output } from '@angular/core';

export type Menu = 'linhas' | 'paradas' | 'trajetos' | 'favoritas' | 'ajustes';

export const MENUS: { id: Menu; nome: string; icone: string }[] = [
  { id: 'linhas', nome: 'Linhas', icone: 'M4 6h16M4 12h16M4 18h16' },
  {
    id: 'paradas',
    nome: 'Paradas',
    icone: 'M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11ZM12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  },
  {
    id: 'trajetos',
    nome: 'Trajetos',
    icone: 'M6 5h11a4 4 0 0 1 0 8H7a4 4 0 0 0 0 8h11M6 2v6M18 18v5',
  },
  {
    id: 'favoritas',
    nome: 'Favoritas',
    icone: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z',
  },
  {
    id: 'ajustes',
    nome: 'Ajustes',
    icone: 'M4 6h4M12 6h8M4 12h10M18 12h2M4 18h2M10 18h10M8 3v6M16 9v6M8 15v6',
  },
];

@Component({
  selector: 'app-navegacao',
  templateUrl: './navegacao.html',
  styleUrl: './navegacao.scss',
})
export class Navegacao {
  readonly atual = input.required<Menu | null>();
  readonly favoritas = input(0);
  readonly escolhido = output<Menu>();
  protected readonly menus = MENUS;
}
