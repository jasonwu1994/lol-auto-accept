export interface Revisioned {revision: number; connectionGeneration: number}
export interface SnapshotSource<T> {listen(handler: (value:T)=>void):Promise<()=>void>; bootstrap():Promise<T>}
export async function subscribeSnapshot<T extends Revisioned>(source:SnapshotSource<T>, apply:(value:T)=>void):Promise<()=>void> {
  let active = true;
  let ready = false;
  let latest: T | undefined;
  const buffered: T[] = [];
  const accept = (value:T) => {
    if (!active || (latest && (value.connectionGeneration < latest.connectionGeneration || (value.connectionGeneration === latest.connectionGeneration && value.revision <= latest.revision)))) return;
    latest = value;
    apply(value);
  };
  const unlisten = await source.listen(value => {if (ready) accept(value); else buffered.push(value);});
  try {
    accept(await source.bootstrap());
    ready = true;
    buffered.sort((a,b) => a.connectionGeneration-b.connectionGeneration || a.revision-b.revision).forEach(accept);
  } catch (error) {active = false; unlisten(); throw error;}
  return () => {active = false; unlisten();};
}
