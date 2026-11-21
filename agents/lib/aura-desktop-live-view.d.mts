export type AuraDesktopLiveFrame =
  | {ok:true; png:Buffer; at:string; sha256:string; missionId:string}
  | {ok:false; reason:string};
export function readAuraDesktopLiveFrame(input:{
  mission: {id:string; status:string; executor:string; receipts?:unknown[]} | null;
  file:string;
  env?: NodeJS.ProcessEnv;
  now?: number;
  read?: (path:string)=>Buffer;
  stat?: (path:string)=>{size:number;mtimeMs:number;isFile():boolean};
}): AuraDesktopLiveFrame;
