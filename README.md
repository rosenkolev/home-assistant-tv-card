# home-assistant-tv-card
An example of a simple tv card for home assistant with JavaScript and Lit-Element. A great start for any custom UI card.

![](./docs/view.png)

The card support the visual Editor.

## Create a custom card manually

1. Upload (or create) one of the files in the the `CONFIG` folder under `www`.
   
   Example: CONFIG/www/local/simple-media-player-card.js

   NOTE: The `www` folder may be missing. If this is the case create it and restart home assistant. Also, You can create/upload the file directly under `www` or create any number of sub-folders.

1. Go to `Settings` -> `Dashboards` -> options (the 3 dots menu) -> Resources or navigate to `/config/lovelace/resources`.
1. `Add Resource` of type `JavaScript module` with url `local/path-to-js-file?v=1` (e.g. `local/local/simple-media-player-card.js?v=1`).
  
   The suffix `?v=1` is used to refresh the cache when the `js` files changes. If you do any changes to the source code you need to go again to resources and change the version `?v=2`, `?v=3`, etc.

1. Go to a dashboard and try the new card.
