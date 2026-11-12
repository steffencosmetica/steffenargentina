import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refundOutcome } from './refund-flow.ts';

test('timeout, red y 409 consultan resultado y no crean otra intención', async () => {
  for (const error of ['timeout','network','conflict',null]) {
    let observations=0;
    assert.equal(await refundOutcome(async()=>error,async received=>{
      observations++; assert.equal(received,error); return 'confirmed';
    }),'confirmed');
    assert.equal(observations,1);
  }
});
test('envío exitoso sin evidencia persistida nunca afirma confirmación',async()=>{
  for(const state of ['unknown','stale','processing',null,'inventado']) {
    assert.equal(await refundOutcome(async()=>null,async()=>state),'unknown');
  }
  assert.equal(await refundOutcome(async()=>null,async()=>{throw new Error('PostgreSQL');}),'unknown');
});
test('caída del envío también consulta y distingue rechazo definitivo',async()=>{
  assert.equal(await refundOutcome(async()=>{throw new Error('network');},async error=>{
    assert.equal(error,'network'); return 'rejected';
  }),'rejected');
});
