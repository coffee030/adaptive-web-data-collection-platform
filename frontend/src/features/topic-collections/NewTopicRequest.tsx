import { useCallback, useEffect, useReducer, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Loading, RequestProblem } from '../../components/feedback';
import { apiPost, ApiError } from '../../lib/api';
import { forgetRequestIntent, isUncertainWrite, prepareRequestIntent } from '../../lib/requestIntent';
import { useResource } from '../../lib/useResource';
import { newJobPath } from '../collection-jobs/api';
import { newRequestPath, requestPath, requestsPath, type Category, type CollectionRequest, type Topic } from './api';
import {
  clearSelection, getCollectionDraft, keywordError, maxBindings, readActiveTopic, readEligibleSources, reviewKey,
  samePin, type CollectionInput, type CollectionSelection,
} from './collectionDraft';
import { CollectionSummary, SourceChoices, TopicBindingSetup } from './CollectionSelection';
import { TopicBrowser } from './TopicBrowser';
import { ActionFeedback, Resource, useAction } from './support';

class CollectionCheck extends Error {}

function requiresEligibilityReload(error: unknown) {
  return error instanceof ApiError && (error.status === 403 || error.status === 404 ||
    ['binding_ineligible', 'profile_not_approved', 'topic_inactive', 'destination_denied'].includes(error.code ?? ''));
}

function submissionProblem(error: unknown) {
  if (error instanceof CollectionCheck) return error.message;
  if (error instanceof ApiError) {
    if (error.status === 403) return 'Source access was denied. Check the latest approved sources before trying again.';
    if (error.code === 'collection_request_conflict') return 'This submission key belongs to another request. Check Collection requests before starting a new attempt.';
    if (requiresEligibilityReload(error)) return 'A topic, source, or approved profile changed. Check the latest selection and review it again.';
    if (error.status === 422) return 'The server rejected the collection details. Check the keyword and selected sources.';
    if (error.status === 409) return 'The collection could not start because its current settings conflict. Review the choices before retrying.';
  }
  return 'The request could not be confirmed. Check the connection and retry this same submission.';
}

export function NewTopicRequest() {
  const location = useLocation();
  const [params] = useSearchParams();
  const draftKey = typeof location.state?.collectionDraft === 'string' ? location.state.collectionDraft : location.key;
  return <CollectionWorkspace key={draftKey} draftKey={draftKey} entryKey={location.key} topicId={params.get('topic_id')} />;
}

function CollectionWorkspace({ draftKey, entryKey, topicId }: { draftKey: string; entryKey: string; topicId: string | null }) {
  const navigate = useNavigate();
  const [draft] = useState(() => getCollectionDraft(draftKey));
  const [, renderDraft] = useReducer((revision: number) => revision + 1, 0);
  const [browse, setBrowse] = useState(topicId === null);
  const [browserMounted, setBrowserMounted] = useState(browse);
  const [uncertain, setUncertain] = useState(!!draft.pending);
  const [keywordTouched, setKeywordTouched] = useState(false);
  const [selectionNotice, setSelectionNotice] = useState('');
  const [preflightNotice, setPreflightNotice] = useState('');
  const [revision, reload] = useReducer((value: number) => value + 1, 0);
  const topicHeading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const recoveryHeading = useRef<HTMLHeadingElement>(null);
  const focusAfterTopic = useRef(false);
  const focusAfterReview = useRef(false);
  const focusAfterRecovery = useRef(false);
  const action = useAction(submissionProblem, entryKey);
  const checkTopic = useCallback((signal: AbortSignal) => readActiveTopic(topicId ?? '', signal), [topicId]);
  const current = useResource(checkTopic, revision, false, topicId !== null);
  const context = current.result.state === 'ready' ? current.result.data : undefined;
  const selectedForTopic = draft.selectionTopic === topicId;
  const getSources = useCallback((signal: AbortSignal) => readEligibleSources(
    topicId ?? '', draft.selectionTopic === topicId ? draft.bindingPages : 1, signal,
  ), [topicId, draft]);
  const recovery = !!draft.pending && (uncertain || !action.busy);
  const sources = useResource(getSources, revision, true, !!context && !draft.submitted && !recovery);
  const sourceData = sources.result.state === 'ready' ? sources.result.data : undefined;
  const selected = selectedForTopic ? draft.selected : [];
  const chosen = sourceData?.rows.filter(row => selected.some(binding => samePin(binding, row))) ?? [];
  const invalidKeyword = keywordError(draft.keyword);
  const selection = context && {
    category: context.category.name, topic: context.topic.name, keyword: draft.keyword.trim(), sources: chosen,
  };
  const canReview = !!selection && !!chosen.length && !!draft.keyword && !sources.refreshing;
  const reviewed = canReview && !invalidKeyword && draft.reviewed === reviewKey(selection);

  useEffect(() => {
    if (!sourceData || sources.refreshing || draft.selectionTopic !== topicId) return;
    const remaining = draft.selected.filter(binding => sourceData.rows.some(row => samePin(binding, row)));
    if (remaining.length !== draft.selected.length) {
      const removed = draft.selected.filter(binding => !remaining.includes(binding)).map(binding => binding.source_name);
      draft.selected = remaining;
      draft.reviewed = undefined;
      setSelectionNotice(`${removed.join(', ')} ${removed.length === 1 ? 'is' : 'are'} no longer available among the verified sources and ${removed.length === 1 ? 'was' : 'were'} removed. Review the source selection.`);
      renderDraft();
    }
  }, [draft, sourceData, sources.refreshing, topicId]);

  useEffect(() => {
    if (!context && topicId !== null && current.result.state === 'ready' && draft.selectionTopic === topicId) {
      clearSelection(draft);
      renderDraft();
    }
  }, [context, current.result.state, draft, topicId]);

  useEffect(() => {
    if (context && focusAfterTopic.current) {
      focusAfterTopic.current = false;
      topicHeading.current?.focus();
    }
  }, [context]);

  useEffect(() => {
    if (reviewed && focusAfterReview.current) {
      focusAfterReview.current = false;
      reviewHeading.current?.focus();
    }
  }, [reviewed]);

  useEffect(() => {
    if (recovery && focusAfterRecovery.current) {
      focusAfterRecovery.current = false;
      recoveryHeading.current?.focus();
    }
  }, [recovery]);

  useEffect(() => {
    if (!sourceData || sources.refreshing || !draft.returnFocus) return;
    const target = document.getElementById(draft.returnFocus) ?? document.getElementById('approved-sources');
    draft.returnFocus = undefined;
    if (document.activeElement === document.body || document.activeElement?.id === 'main-content') target?.focus();
  }, [draft, sourceData, sources.refreshing]);

  function edit() {
    draft.reviewed = undefined;
    setPreflightNotice('');
    action.clearError();
    renderDraft();
  }

  function chooseCategory(category: Category) {
    if (category.id === (context?.category ?? draft.category)?.id) return;
    draft.category = category;
    clearSelection(draft);
    setSelectionNotice('');
    edit();
    if (topicId !== null) void navigate(newRequestPath, { state: { collectionDraft: draftKey }, preventScrollReset: true });
  }

  function chooseTopic(topic: Topic) {
    if (topic.id !== topicId) {
      clearSelection(draft);
      draft.selectionTopic = topic.id;
      setSelectionNotice('');
      edit();
      void navigate(`${newRequestPath}?${new URLSearchParams({ topic_id: topic.id })}`, {
        state: { collectionDraft: draftKey }, preventScrollReset: true,
      });
      focusAfterTopic.current = true;
    } else {
      requestAnimationFrame(() => topicHeading.current?.focus());
    }
    setBrowse(false);
  }

  function verifyAndReview(event: FormEvent) {
    event.preventDefault();
    setKeywordTouched(true);
    if (!selection || !canReview || invalidKeyword || action.busy) return;
    draft.reviewed = reviewKey(selection);
    focusAfterReview.current = true;
    setPreflightNotice('');
    action.clearError();
    renderDraft();
  }

  function runCollection() {
    if (recovery ? !draft.pending : !reviewed || !selection || !context) return;
    if (recovery) setUncertain(true);
    void action.run(async signal => {
      let pending = draft.pending;
      if (!pending && selection && context) {
        const topic = await checkTopic(signal).catch(() => {
          throw new CollectionCheck('Could not verify the topic. Check the connection and try again.');
        });
        signal.throwIfAborted();
        if (!topic || topic.category.id !== context.category.id) {
          clearSelection(draft);
          reload();
          throw new CollectionCheck('The selected topic is unavailable or has moved. Choose and review a topic again.');
        }
        const latest = await getSources(signal).catch(() => {
          throw new CollectionCheck('Could not verify the approved sources. Check the connection and try again.');
        });
        signal.throwIfAborted();
        const pinned = latest.rows.filter(row => selection.sources.some(binding => samePin(binding, row)));
        const verified = { ...selection, category: topic.category.name, topic: topic.topic.name, sources: pinned };
        if (reviewKey(verified) !== draft.reviewed) {
          draft.reviewed = undefined;
          setPreflightNotice('The topic or approved sources changed. Check the latest choices and review them again.');
          reload();
          return;
        }
        const input: CollectionInput = {
          topic_id: topic.topic.id, keyword: selection.keyword, binding_ids: pinned.map(row => row.id).sort(),
        };
        const intent = await prepareRequestIntent(requestsPath, input);
        signal.throwIfAborted();
        pending = { intent, selection };
        draft.pending = pending;
      }
      if (!pending) return;
      try {
        const request = await apiPost<CollectionRequest>(requestsPath, pending.intent.body, signal);
        if (typeof request?.id !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(request.id)
          || request.topic_id !== pending.intent.body.topic_id || request.keyword !== pending.intent.body.keyword
          || !Array.isArray(request.jobs)) {
          throw new ApiError('invalid-response');
        }
        forgetRequestIntent(pending.intent);
        draft.pending = undefined;
        draft.submitted = request.id;
        draft.keyword = '';
        draft.category = undefined;
        clearSelection(draft);
        return request;
      } catch (error) {
        if (isUncertainWrite(error)) {
          if (!signal.aborted) {
            focusAfterRecovery.current = !recovery;
            setUncertain(true);
          }
        } else {
          forgetRequestIntent(pending.intent);
          draft.pending = undefined;
          if (!signal.aborted) {
            setUncertain(false);
            if (requiresEligibilityReload(error)) {
              draft.reviewed = undefined;
              reload();
            }
          }
        }
        throw error;
      }
    }, request => {
      if (request) void navigate(requestPath(request.id), { replace: true, state: { collectionCreated: true } });
    });
  }

  const unavailable = topicId !== null && current.result.state === 'ready' && !context;
  const browsing = browse || topicId === null || unavailable;
  const showBrowser = browserMounted || browsing;

  return <div className="new-collection collection-text">
    <header className="new-collection-title">
      <h1>New Collection</h1>
      <Link to={newJobPath}>Single-source collection and CSV import</Link>
    </header>
    {draft.submitted ? <section className="collection-section">
      <h2>Collection request submitted</h2>
      <div className="collection-actions">
        <Link className="control primary" to={requestPath(draft.submitted)}>View submitted request</Link>
        <Link to={newRequestPath}>Start another collection</Link>
      </div>
    </section> : recovery && draft.pending ? <section className="collection-section" aria-labelledby="recover-collection">
      <h2 id="recover-collection" ref={recoveryHeading} tabIndex={-1}>Confirm your submission</h2>
      <p>Retry this submission to check whether the request was created and avoid starting duplicate jobs.</p>
      <CollectionSummary selection={draft.pending.selection} />
      <ActionFeedback action={action} pending="Checking the original submission…" />
      <div className="collection-actions">
        <button type="button" className="primary" aria-disabled={action.busy} onClick={runCollection}>Retry submission</button>
        <Link to={requestsPath}>View collection requests</Link>
      </div>
    </section> : <>
      {showBrowser && <div hidden={!browsing}>
        <TopicBrowser category={context?.category ?? draft.category} topic={context?.topic}
          onCategory={chooseCategory} onTopic={chooseTopic}>
          {unavailable && <p className="form-problem" role="alert">This topic is invalid or is no longer available. Choose another topic.</p>}
        </TopicBrowser>
      </div>}
      {topicId !== null && !context && !unavailable && <section className="collection-section" aria-label="Selected topic">
        <Resource state={current} label="selected topic">{() => null}</Resource>
        <button type="button" onClick={() => {
          clearSelection(draft);
          edit();
          void navigate(newRequestPath, { state: { collectionDraft: draftKey }, preventScrollReset: true });
          setBrowse(true);
        }}>Choose another topic</button>
      </section>}
      {context && !browsing && <section className="collection-topic" aria-labelledby="selected-topic">
        <div>
          <p className="muted">{context.category.name}</p>
          <h2 id="selected-topic" ref={topicHeading} tabIndex={-1}>{context.topic.name}</h2>
        </div>
        <button type="button" disabled={action.busy} onClick={() => {
          setBrowserMounted(true);
          setBrowse(true);
          requestAnimationFrame(() => document.getElementById('choose-topic')?.focus());
        }}>Choose another topic</button>
      </section>}
      {context && browsing && <div className="collection-actions">
        <button type="button" onClick={() => chooseTopic(context.topic)}>Keep {context.topic.name}</button>
      </div>}
      {context && !browsing && <>
        <section className="collection-section sources-section" aria-labelledby="approved-sources">
          <div className="collection-row-heading">
            <h2 id="approved-sources" tabIndex={-1}>Approved sources</h2>
            {sourceData && <button type="button" aria-disabled={sources.refreshing || action.busy} onClick={() => {
              if (!sources.refreshing && !action.busy) sources.retry();
            }}>Reload sources</button>}
          </div>
          <p className="muted">Choose up to four. Each selection runs as a separate job.</p>
          {selectionNotice && <p className="form-problem" role="alert">{selectionNotice}</p>}
          <Resource label="approved sources" state={{ ...sources, retry: () => {
            document.getElementById('approved-sources')?.focus();
            sources.retry();
          } }}>
            {data => <>
              {sources.refreshing && <Loading>Checking approved sources…</Loading>}
              {data.rows.length ? <>
                <p className="selection-count" role="status">{chosen.length} of {maxBindings} selected</p>
                <fieldset disabled={sources.refreshing || action.busy} className="collection-fieldset">
                  <legend className="sr-only">Sources to collect from</legend>
                  <SourceChoices rows={data.rows} selected={chosen} onChange={rows => {
                    draft.selectionTopic = topicId ?? undefined;
                    draft.selected = rows;
                    setSelectionNotice('');
                    edit();
                  }} onInspect={id => { draft.returnFocus = id; }} />
                </fieldset>
              </> : !sources.refreshing && !data.more && <TopicBindingSetup topicId={context.topic.id} />}
              {data.more && <button type="button" aria-disabled={sources.refreshing || action.busy} onClick={() => {
                if (sources.refreshing || action.busy) return;
                draft.selectionTopic = context.topic.id;
                draft.bindingPages++;
                sources.retry();
              }}>Load more approved sources</button>}
            </>}
          </Resource>
        </section>
        {(chosen.length > 0 || draft.keyword) && <section className="collection-section" aria-labelledby="collection-keyword-title">
          <h2 id="collection-keyword-title">Keyword</h2>
          <form className="collection-keyword" noValidate onSubmit={verifyAndReview}>
            <label htmlFor="collection-keyword" className="sr-only">Keyword</label>
            <p id="keyword-help" className="muted">Enter 1–128 printable characters. Each approved profile searches for the same keyword.</p>
            <input id="collection-keyword" type="text" required value={draft.keyword} disabled={action.busy}
              aria-describedby={keywordTouched && invalidKeyword ? 'keyword-help keyword-error' : 'keyword-help'}
              aria-invalid={keywordTouched && !!invalidKeyword} onChange={event => {
                draft.keyword = event.target.value;
                edit();
              }} onBlur={() => { if (draft.keyword) setKeywordTouched(true); }} />
            {keywordTouched && invalidKeyword && <p id="keyword-error" className="form-problem" role="alert">{invalidKeyword}</p>}
            <div className="collection-actions">
              {!reviewed && <button type="submit" className="primary" disabled={!chosen.length || sources.refreshing || action.busy}>Review collection</button>}
              {!chosen.length && <span className="muted">Choose an approved source to continue.</span>}
            </div>
          </form>
        </section>}
      </>}
      {preflightNotice && <p className="form-problem" role="alert">{preflightNotice}</p>}
      {reviewed && selection && !browsing && <section className="collection-section collection-review" aria-labelledby="review-collection">
        <h2 id="review-collection" tabIndex={-1} ref={reviewHeading}>Review collection</h2>
        <CollectionSummary selection={selection} />
        <ActionFeedback action={action} pending="Checking approved sources and submitting the request…" />
        <div className="collection-actions">
          <button type="button" className="primary" aria-disabled={action.busy} onClick={runCollection}>Start topic collection</button>
        </div>
      </section>}
      {!reviewed && <ActionFeedback action={action} pending="Checking approved sources and submitting the request…" />}
    </>}
  </div>;
}
