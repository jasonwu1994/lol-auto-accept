import type {AppSnapshot} from './contracts';
import type {SnapshotSource} from './subscription';
export class FakeDesktop implements SnapshotSource<AppSnapshot> {
  private listeners=new Set<(value:AppSnapshot)=>void>();
  constructor(public state:AppSnapshot) {}
  async bootstrap() {return structuredClone(this.state);}
  async listen(handler:(value:AppSnapshot)=>void) {this.listeners.add(handler);return ()=>{this.listeners.delete(handler);};}
  emit(state:AppSnapshot) {this.state=state;this.listeners.forEach(handler=>handler(structuredClone(state)));}
  get listenerCount() {return this.listeners.size;}
}
