# Public creator directory

The directory helps a company research Hong Kong creators by name or topic before it has independent campaign evidence. All signed-in companies see the same licensed directory records. Researching a name can lead to a search in the company’s separate private catalog. Only that private catalog supplies the content evidence and confirmed fees used by Campaign Advisor.

The password-free Windows demo has its own database and source approval. Its public research screen can read only current directory records from that installation. It uses a separate read-only endpoint, enabled only with an explicit public-directory setting, demo mode active and no partner workspace configured. Withdrawing this source removes these listings. Company catalogs and campaign records retain their existing access requirements.

## Source and permitted fields

Wikidata publishes its main-namespace structured data under CC0. The feed requests names, descriptions, item identifiers and revision numbers from eleven reviewed public figures or production teams with Hong Kong creator activity. Multilingual names and descriptions retain their source text. Every displayed profile links to the exact Wikidata revision. These records establish a public description at a particular revision. No creator has agreed to a campaign by appearing in the directory. [Wikidata licensing](https://www.wikidata.org/wiki/Wikidata:Licensing) · [Wikimedia API guidelines](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_API_Usage_Guidelines)

The request uses an identified client, a fixed HTTPS destination, a bounded list of item IDs, one batched response, a size limit, and Wikimedia's maxlag control. Handles, images, videos, viewer counts, channel statistics, private contact information, demographic characteristics and quotes are outside the field mapping. The release includes a dated CC0 snapshot of the same fields. Its observation time is the actual acquisition time.

## Operator review and recovery

The Harbourline launchers install the reviewed release mappings and submit their first collections. Customer results appear after the workers publish them. Operators use these steps to inspect a mapping or restore it after an explicit decision. Historical works have a separate mapping and publication receipt. [Public research sources](../operations/Public-Research-Sources.md)

1. On the private pilot or the isolated local demo, open **Data Operations → Public creator directory**. Enter the system operator credential, review the source license and select **Authorize source and preview fields**.
2. Verify the sample name, local name, description, revision and date. Select **Approve mapping and enable refresh**. When still current, the bundled dated capture supplies the first collection. When it has expired, validation requires a current response from Wikidata.
3. The existing dispatcher and collection worker process the normalized CSV through the approved Core profile, including validation, deduplication, raw CSV Evidence and durable Records. The public directory reads successful Jobs for this registered source and mapping. Core evidence captures the projected CSV. The upstream revision link identifies the input item independently.
4. An approved feed normally refreshes daily. Transient network failures retain the last unexpired successful snapshot and retry after an hour. An explicit access block suspends refresh and hides listings until operator review. If a checked snapshot is more than seven days old, customer reads return an expired state. **Withdraw public directory** disables collection and removes the shared listings from customer reads. The Core retains its public, revision-linked audit history.

Directory queries prioritize literal name and description matches. Otherwise, they order related source descriptions by local multilingual Granite embeddings, with a character TF-IDF fallback. Comparisons display the underlying descriptions and source revisions. Catalog inclusion, similarity and display order do not establish creator availability, language of a creator’s posts, commercial representation, price, audience quality or campaign performance.
