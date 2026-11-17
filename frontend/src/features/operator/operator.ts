export function isLocalOperator() {
  return __LOCAL_PROFILE_APPROVAL__ && window.location.protocol === 'http:' && window.location.hostname === '127.0.0.1';
}

export const localOperatorHelp = 'Changes here require the local operator console with approval enabled on 127.0.0.1.';
