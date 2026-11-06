export function decimalId(value:unknown):string {
  if(typeof value === 'number') {
    if(!Number.isSafeInteger(value) || value < 0) throw new Error('Unsafe numeric identifier');
    return String(value);
  }
  if(typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || BigInt(value)>18446744073709551615n) throw new Error('Invalid identifier');
  return value;
}
export function hasPlayerId(value:unknown):boolean {
  try {return decimalId(value)!=='0';} catch {return false;}
}
