// Modelo de diagnóstico para la futura conciliación SMTP. No habilita ni envía correos.
// La falta de respuesta final después de DATA no demuestra ni aceptación ni rechazo.
export type SmtpEvidence='accepted'|'permanent_failure'|'temporary_failure'|'uncertain';
export function smtpEvidence(input:{phase:'connect'|'envelope'|'data'|'final_ack'|'unknown';responseCode?:number;accepted?:number}):SmtpEvidence{
 if(input.phase==='final_ack'&&input.responseCode===250&&input.accepted===1)return 'accepted';
 const code=input.responseCode;
 if(code!==undefined&&[530,534,535].includes(code))return 'temporary_failure';
 if(code!==undefined&&code>=500&&code<=599)return 'permanent_failure';
 if(code!==undefined&&code>=400&&code<=499)return 'temporary_failure';
 if(input.phase==='connect'||input.phase==='envelope')return 'temporary_failure';
 return 'uncertain';
}
