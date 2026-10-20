import { describe, expect, it } from 'vitest';
import { loginPageUrl, safeReturn } from './session';

describe('safeReturn', () => {
  it('laat paden binnen de app toe, met en zonder basispad', () => {
    expect(safeReturn('', '/prospects/123?tab=mail')).toBe('/prospects/123?tab=mail');
    expect(safeReturn('/tool', '/tool/prospects/123')).toBe('/tool/prospects/123');
  });

  it('valt terug op het dashboard bij onveilige of ontbrekende waarden', () => {
    expect(safeReturn('', null)).toBe('/dashboard');
    expect(safeReturn('', undefined)).toBe('/dashboard');
    expect(safeReturn('', 'https://evil.example/')).toBe('/dashboard');
    expect(safeReturn('', '//evil.example/x')).toBe('/dashboard');
    expect(safeReturn('', '/a\\b')).toBe('/dashboard');
    expect(safeReturn('/tool', '/ander/pad')).toBe('/tool/dashboard');
  });

  it('stuurt nooit terug naar de loginpagina zelf (geen lus)', () => {
    expect(safeReturn('', '/login')).toBe('/dashboard');
    expect(safeReturn('', '/login?expired=1')).toBe('/dashboard');
    expect(safeReturn('/tool', '/tool/login')).toBe('/tool/dashboard');
  });
});

describe('loginPageUrl', () => {
  it('bouwt de inlog-URL met melding en terugkeerpagina', () => {
    expect(loginPageUrl('', '/prospects/123?tab=mail')).toBe(
      '/login?expired=1&returnTo=%2Fprospects%2F123%3Ftab%3Dmail',
    );
  });

  it('valt voor een onveilig pad terug op het dashboard', () => {
    expect(loginPageUrl('', '//evil.example')).toBe('/login?expired=1&returnTo=%2Fdashboard');
  });
});
