export default function AuthReducer(state={connection:'Disconnected'},action) {return action.type==='change-connection' ? {connection:action.data} : state;}
