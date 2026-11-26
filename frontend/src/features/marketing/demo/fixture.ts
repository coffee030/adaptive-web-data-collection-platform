import { blankBrief, type Brief, type Creator } from '../contracts';
import mira from './media/mira-portrait.webp';
import ethan from './media/ethan-portrait.webp';
import chloe from './media/chloe-portrait.webp';
import jay from './media/jay-portrait.webp';
import miraPost from './media/mira-post.webp';
import ethanPost from './media/ethan-post.webp';
import chloePost from './media/chloe-post.webp';
import jayPost from './media/jay-post.webp';

export const demoBrief: Brief = {
  ...blankBrief, name: 'Sheung Wan coffee launch', budget: 30000, platform: 'Instagram',
  language: 'Cantonese', deliverable: 'Instagram Reel', minAudience: 60, requireCantonese: true,
  description: 'Launch Tide Coffee’s Sheung Wan shop with two Instagram creators who speak Cantonese and reach a Hong Kong audience.',
  preferred: 'Neighbourhood café tours and viewers aged 22–34.',
};

export const demoCreators: readonly Creator[] = [
  { id:'mira', name:'Mira Lau', handle:'@miralau.food', district:'Sheung Wan', category:'Café culture',
    followers:38200,hk:76,typicalViews:21400,quote:8500,observed:'24 Nov 2026',sample:12,cantonese:true,expired:false,portrait:mira,
    post:{title:'A slow afternoon in Sheung Wan',date:'22 Nov 2026',caption:'上環慢慢行，飲杯咖啡先。',lang:'yue-Hant',translation:'A slow walk through Sheung Wan, then a coffee.',still:miraPost, transcript:{time:'0:04–0:07',text:'行到呢條街，就聞到咖啡香。',translation:'As soon as you reach this street, you can smell the coffee.'}},
    reason:'The Reel follows a Sheung Wan side street into the café and ends with the drink order. It supports the neighbourhood tour preference.' },
  { id:'ethan', name:'Ethan Ko', handle:'@ethanbrews', district:'Central', category:'Specialty coffee',
    followers:54600,hk:64,typicalViews:26800,quote:10500,observed:'23 Nov 2026',sample:12,cantonese:true,expired:false,portrait:ethan,
    post:{title:'From first pour to first sip',date:'21 Nov 2026',caption:'由第一注到第一啖，試吓呢杯手沖。',lang:'yue-Hant',translation:'From the first pour to the first sip, try this hand brew.',still:ethanPost, transcript:{time:'0:09–0:12',text:'呢杯手沖飲落有少少橙香。',translation:'This hand brew has a slight orange note.'}},
    reason:'The historical Reel uses spoken Cantonese to explain a coffee preparation and tasting notes, a format suited to introducing a menu.' },
  { id:'chloe', name:'Chloe Mak', handle:'@chloes.table', district:'Wan Chai', category:'Food & lifestyle',
    followers:27900,hk:null,typicalViews:16200,quote:null,observed:'22 Nov 2026',sample:10,cantonese:true,expired:false,portrait:chloe,
    post:{title:'Tea and something sweet',date:'19 Nov 2026',caption:'下午茶，梗係要叫件甜品。',lang:'yue-Hant',translation:'Afternoon tea calls for a slice of dessert.',still:chloePost, transcript:{time:'0:06–0:09',text:'呢件蛋糕襯呢杯茶啱啱好。',translation:'This cake goes perfectly with this tea.'}},
    reason:'Tea and dessert appear together in a tabletop feature. Hong Kong audience coverage and a quote are still unavailable.' },
  { id:'jay', name:'Jay Tsang', handle:'@jayaroundhk', district:'Sham Shui Po', category:'Neighbourhood guides',
    followers:46100,hk:69,typicalViews:18900,quote:7500,observed:'4 Oct 2026',sample:10,cantonese:null,expired:true,portrait:jay,
    post:{title:'After dark in the neighbourhood',date:'30 Sep 2026',caption:'After dark in the neighbourhood.',still:jayPost},
    reason:'The storefront sequence fits a neighbourhood introduction. This sample has a caption and no reviewable spoken language evidence.' },
];

export function demoSearch(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return demoCreators;
  if (normalized === '上環 café tour' || normalized === '街坊咖啡店') return demoCreators.filter(creator => creator.id === 'mira');
  return demoCreators.filter(creator => [creator.name, creator.handle, creator.district, creator.category, creator.post.title, creator.post.caption,
    creator.post.translation].some(value => value?.toLowerCase().includes(normalized)));
}