import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterSalesEnabled } from './after-sales-config.ts';

const local = { NODE_ENV:'development', STEFFEN_MP_MODE:'mock', STEFFEN_MP_RECONCILIATION:'1',
  STEFFEN_MP_AFTER_SALES:'1',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:55321' };
test('posventa exige habilitación explícita y aislamiento local', () => {
  assert.equal(afterSalesEnabled(local),true);
  assert.equal(afterSalesEnabled({}),false);
  for (const change of [{NODE_ENV:'production'},{VERCEL:'1'},{VERCEL_ENV:'preview'},
    {STEFFEN_TRUSTED_PROXY:'1'},{STEFFEN_MP_MODE:'live'},{STEFFEN_MP_AFTER_SALES:'0'},
    {NEXT_PUBLIC_SUPABASE_URL:'https://zzxlghpopmccwsaqbsko.supabase.co'}]) {
    assert.equal(afterSalesEnabled({...local,...change}),false);
  }
});
