import { Link, useLocation, useNavigate, type LinkProps } from 'react-router';
import { rememberPosition } from '../results/resultNavigation';

export function OperatorLink({ id, state, ...props }: LinkProps & { id: string }) {
  const { pathname, search, key } = useLocation();
  return <Link {...props} id={id} state={{ ...state, operatorOrigin: pathname + search }}
    onClick={event => {
      props.onClick?.(event);
      if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        rememberPosition(key, id);
      }
    }} />;
}

export function OperatorReturn({ to, ...props }: Omit<LinkProps, 'to'> & { to: string }) {
  const { state } = useLocation();
  const navigate = useNavigate();
  return <Link {...props} to={to} onClick={event => {
    if (!event.defaultPrevented && state?.operatorOrigin === to
      && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      void navigate(-1);
    }
  }} />;
}

export function BackToBindings() {
  const { state } = useLocation();
  const origin: unknown = state?.bindingOrigin;
  return typeof origin === 'string' && /^\/topics\/[\da-f-]+(?:\?offset=\d+)?$/i.test(origin)
    ? <OperatorReturn to={origin}>Back to topic bindings</OperatorReturn>
    : null;
}
