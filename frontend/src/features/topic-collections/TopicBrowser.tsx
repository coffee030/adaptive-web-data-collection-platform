import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { topicsPath, categoriesPath, type Category, type Topic } from './api';
import { MoreOptions, Resource, useOptions } from './support';

const catalogPageSize = 12;

function CatalogList<T extends Category>({ rows, selected, choose }: {
  rows: T[];
  selected?: string;
  choose: (row: T) => void;
}) {
  return <ul className="catalog-choices" role="list">
    {rows.map(row => <li key={row.id}>
      <button type="button" aria-pressed={selected === row.id} onClick={() => choose(row)}>
        <span>{row.name}</span>
        {selected === row.id && <span className="catalog-current" aria-hidden="true">✓</span>}
      </button>
    </li>)}
  </ul>;
}

function includeSelection<T extends Category>(rows: T[], current?: T) {
  return current && !rows.some(row => row.id === current.id) ? [current, ...rows] : rows;
}

export function TopicBrowser({ category, topic, onCategory, onTopic, children }: {
  category?: Category;
  topic?: Topic;
  onCategory: (row: Category) => void;
  onTopic: (row: Topic) => void;
  children?: ReactNode;
}) {
  const [choosingCategory, setChoosingCategory] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const topicHeading = useRef<HTMLHeadingElement>(null);
  const categories = useOptions<Category>(categoriesPath, 'active_only=true', { pageSize: catalogPageSize });
  const topics = useOptions<Topic>(topicsPath, new URLSearchParams({
    active_only: 'true', category_id: category?.id ?? '',
  }).toString(), { enabled: !!category, pageSize: catalogPageSize });
  const categoryRows = includeSelection(categories.rows.filter(row => row.active), category);
  const emptyCatalog = categories.state.result.state === 'ready' && !categoryRows.length;
  const topicRows = includeSelection(topics.rows.filter(row => row.active && row.category_id === category?.id), topic);

  return <section className="collection-section" aria-labelledby="choose-topic">
    <h2 id="choose-topic" ref={heading} tabIndex={-1}>Choose a topic</h2>
    {children}
    <div className="topic-browser" data-empty={emptyCatalog} data-category={!!category} data-picking-category={choosingCategory}>
      <div className="catalog-group">
        <div className="collection-row-heading">
          <h3>Categories</h3>
          {category && <button className="catalog-category-toggle" type="button"
            aria-controls="category-options" aria-expanded={choosingCategory}
            onClick={() => setChoosingCategory(value => !value)}>
            {choosingCategory ? 'Hide categories' : 'Change category'}
          </button>}
        </div>
        {category && <p className="catalog-category-summary">{category.name}</p>}
        <div className="catalog-category-options" id="category-options">
          <Resource label="categories" state={{ ...categories.state, retry: () => {
            heading.current?.focus();
            categories.state.retry();
          } }}>
            {() => categoryRows.length ? <>
              <CatalogList rows={categoryRows} selected={category?.id} choose={row => {
                onCategory(row);
                setChoosingCategory(false);
                topicHeading.current?.focus();
              }} />
              <MoreOptions label="categories" options={categories} />
            </> : <div className="catalog-empty">
              <strong>No active categories</strong>
              <p>Set up a category and topic to start a collection.</p>
              <Link to={topicsPath}>Manage categories and topics</Link>
            </div>}
          </Resource>
        </div>
      </div>
      {!emptyCatalog && <div className="catalog-group catalog-topics">
        <h3 ref={topicHeading} tabIndex={-1}>Topics</h3>
        {category ? <Resource label="topics" state={{ ...topics.state, retry: () => {
          topicHeading.current?.focus();
          topics.state.retry();
        } }}>
          {() => topicRows.length ? <>
            <CatalogList rows={topicRows} selected={topic?.id} choose={onTopic} />
            <MoreOptions label="topics" options={topics} />
          </> : <p className="catalog-empty">This category has no active topics.</p>}
        </Resource> : <p className="catalog-empty">Select a category to see its topics.</p>}
      </div>}
    </div>
  </section>;
}
