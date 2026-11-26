import { useCallback, useEffect } from 'react';
import { apiGet } from '../../lib/api';
import { useResource } from '../../lib/useResource';

export interface PublicProfile {
  item:string; revision:string; name:string; local_name:string; description:string; local_description:string; record_id:string; evidence_id:string;
}
export interface Directory {state:'available'|'unavailable'|'expired'; observed:string|null; expires:string|null; retrieval:string; profiles:PublicProfile[]}
export interface PublishedWork {
  visual_evidence?:{source_text:string;interpretation:string;source_language:string;image_sha1:string}|null;
  thumbnail_url?:string|null; pageviews?:{count:number;month:string;source_url:string;license_url:string;scope:string}|null;
  id:string; title:string; date:string; excerpt:string; excerpt_language:string; local_excerpt?:string; local_language?:string;
  archive_url:string; revision_url:string; original_url:string|null; platform:string;
  license:string; license_url:string; text_license_url:string; record_id:string; evidence_id:string;
}
export interface Contributor {
  id:string; name:string; profile_url:string; matched_works:PublishedWork[]; match_basis:'historical_cost'|'historical_topic'|'creator'|'browse';
}
export interface Works {criteria?:string; state:'available'|'unavailable'|'expired'; observed:string|null; expires?:string|null; contributors:Contributor[]}
export function publicPath(isolated:boolean, kind:'works'|'directory', query='') {
  const resource=isolated ? 'public-research/'+kind : 'partner/'+(kind==='works'?'public-works':'public-directory');
  return '/marketing/intelligence/'+resource+'?q='+encodeURIComponent(query);
}
export function usePublicResults<T extends {state:string; expires?:string|null}>(endpoint:string) {
  const load=useCallback((signal:AbortSignal)=>apiGet<T>(endpoint,signal),[endpoint]);
  const request=useResource(load);
  const {result,retry}=request;
  const expires=result.state==='ready' && result.data.state==='available' ? result.data.expires : null;
  useEffect(()=>{
    const refresh=()=>{if(document.visibilityState==='visible') retry();};
    const interval=window.setInterval(refresh,30000);
    const expiry=expires ? window.setTimeout(retry,Math.max(1,Date.parse(expires)-Date.now())) : undefined;
    window.addEventListener('focus',refresh);
    return ()=>{window.clearInterval(interval);window.clearTimeout(expiry);window.removeEventListener('focus',refresh);};
  },[retry,expires]);
  return request;
}
export const revisionUrl=(p:PublicProfile)=>'https://www.wikidata.org/w/index.php?title='+encodeURIComponent(p.item)+'&oldid='+encodeURIComponent(p.revision);
export const checkedDate=(value:string)=>new Date(value).toLocaleDateString('en-HK',{day:'numeric',month:'short',year:'numeric'});
