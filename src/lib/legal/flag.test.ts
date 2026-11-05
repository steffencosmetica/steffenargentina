import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legalPagesEnabledFor, revocationEnabledFor } from './flag.ts';

test('páginas legales y arrepentimiento: apagados por defecto, solo "1" exacto los enciende', () => {
  assert.equal(legalPagesEnabledFor({}), false);
  assert.equal(revocationEnabledFor({}), false);
  for (const v of ['true', 'yes', '0', ' 1', '1 ', '']) {
    assert.equal(legalPagesEnabledFor({ STEFFEN_LEGAL_PAGES: v }), false, v);
    assert.equal(revocationEnabledFor({ STEFFEN_REVOCATION_ENABLED: v }), false, v);
  }
  assert.equal(legalPagesEnabledFor({ STEFFEN_LEGAL_PAGES: '1' }), true);
  assert.equal(revocationEnabledFor({ STEFFEN_REVOCATION_ENABLED: '1' }), true);
  // independientes: publicar las políticas no publica el botón ni al revés
  assert.equal(revocationEnabledFor({ STEFFEN_LEGAL_PAGES: '1' }), false);
  assert.equal(legalPagesEnabledFor({ STEFFEN_REVOCATION_ENABLED: '1' }), false);
});
