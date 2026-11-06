function parseVersion(value:string) {
  const match=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
  if(!match) return null;
  const prerelease=match[4]?.split('.') ?? [];
  if(prerelease.some(part=>/^\d+$/.test(part) && part.length>1 && part.startsWith('0')))return null;
  return {core:match.slice(1,4).map(BigInt),prerelease};
}
export function isNewerVersion(current:string,latest:string):boolean|null {
  const a=parseVersion(current),b=parseVersion(latest);
  if(!a || !b)return null;
  for(let index=0;index<3;index++) {if(a.core[index]!==b.core[index])return b.core[index]>a.core[index];}
  if(!a.prerelease.length || !b.prerelease.length)return Boolean(a.prerelease.length && !b.prerelease.length);
  for(let index=0;index<Math.max(a.prerelease.length,b.prerelease.length);index++) {
    const left=a.prerelease[index],right=b.prerelease[index];
    if(left===right)continue;
    if(left===undefined)return true;
    if(right===undefined)return false;
    const leftNumeric=/^\d+$/.test(left),rightNumeric=/^\d+$/.test(right);
    if(leftNumeric && rightNumeric)return BigInt(right)>BigInt(left);
    if(leftNumeric!==rightNumeric)return leftNumeric;
    return right>left;
  }
  return false;
}
