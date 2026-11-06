// HeroUI theme previews, Apache-2.0; see resources/licenses/heroui.txt.
import defaultPreview from '../resources/themes/default.png';
import skyPreview from '../resources/themes/sky.png';
import lavenderPreview from '../resources/themes/lavender.png';
import mintPreview from '../resources/themes/mint.png';
import netflixPreview from '../resources/themes/netflix.png';
import uberPreview from '../resources/themes/black.png';
import spotifyPreview from '../resources/themes/spotify.png';
import coinbasePreview from '../resources/themes/coinbase.png';
import airbnbPreview from '../resources/themes/airbnb.png';
import discordPreview from '../resources/themes/discord.png';
import rabbitPreview from '../resources/themes/rabbit.png';

export const designThemes = [
  {id:'default', image:defaultPreview, name:'Default'},
  {id:'sky', image:skyPreview, name:'Sky'},
  {id:'lavender', image:lavenderPreview, name:'Lavender'},
  {id:'mint', image:mintPreview, name:'Mint'},
  {id:'netflix', image:netflixPreview, name:'Netflix'},
  {id:'uber', image:uberPreview, name:'Uber'},
  {id:'spotify', image:spotifyPreview, name:'Spotify'},
  {id:'coinbase', image:coinbasePreview, name:'Coinbase'},
  {id:'airbnb', image:airbnbPreview, name:'Airbnb'},
  {id:'discord', image:discordPreview, name:'Discord'},
  {id:'rabbit', image:rabbitPreview, name:'Rabbit'},
];
export const normalizeDesignTheme = value => designThemes.some(theme => theme.id === value) ? value : 'default';
