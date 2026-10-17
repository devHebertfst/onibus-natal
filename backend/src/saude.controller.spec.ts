import { SaudeController } from './saude.controller.js';

describe('SaudeController', () => {
  it('responde só "ok"', () => {
    expect(new SaudeController().ok()).toBe('ok');
  });
});
