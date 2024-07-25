import { ScopedRegistryHost } from 'https://unpkg.com/@lit-labs/scoped-registry-mixin@1.0.3/scoped-registry-mixin.js?module';
import {
  LitElement,
  html,
  css,
  nothing
} from "https://unpkg.com/lit-element@3.3.3/lit-element.js?module";

import { 
  computeDomain,
  hasConfigOrEntityChanged,
  fireEvent
} from 'https://unpkg.com/custom-card-helpers@1.9.0/dist/index.m.js?module';

class MediaPlayerCard extends LitElement {
  static supportedDomains = ['media_player'];
  static get properties() {
    return {
      hass: { attribute: false },
      config: { state: true }
    };
  }

  static getConfigElement() {
    return document.createElement('simple-media-player-card-editor');
  }

  static getStubConfig() {
    return { entity: "media_player.samsung_tv" };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("You need to define an entity");
    }

    const domain = computeDomain(config.entity);
    if (!MediaPlayerCard.supportedDomains.includes(domain)) {
      throw new Error(`The domain ${domain} is not supported!`);
    }

    this.config = { ...config, domain };
  }

  /** Get the card height (x * 50px) (e.g. 3 is 150px). */
  getCardSize() { return 1; }

  shouldUpdate(changedProps) {
    return this.config && this.hass && hasConfigOrEntityChanged(this, changedProps, false);
  }

  render() {
    if (!this.config || !this.hass) {
      return nothing;
    }

    const entity_id = this.config.entity;
    /** @type {MediaPlayerState} */
    const state = this.hass.states[entity_id];
    const name = state.attributes.friendly_name;
    const device = state.attributes.device_class;
    const deviceIcon = device === 'tv' ? 'mdi:television' : 'mdi:cast-variant';
    const stateIcon = state.state === 'off' ? 'mdi:power-plug-off-outline' : state.state === 'idle' ? 'mdi:power-sleep' : 'mdi:power';
    const isOn = state.state === 'on';
    const isOff = state.state === 'off';
    const volume = state.attributes.volume_level * 100;
    const isMuted = state.attributes.is_volume_muted;
    const isMutedIcon = isMuted ? 'mdi:volume-off' : 'mdi:volume-high';
    const volumeEnabled = (state.attributes.supported_features & 4) === 4; // VOLUME_SET: 4
    const muteEnabled = (state.attributes.supported_features & 8) === 8; // VOLUME_MUTE: 8
    const call = (name, data) => this.hass.callService('media_player', name, { entity_id, ...data });
    const toggleMute = () => call('volume_mute', { is_volume_muted: !isMuted });
    const volumeUp = () => call("volume_up");
    const volumeDown = () => call("volume_down");
    const togglePower = () => isOff ? call('turn_on') : call('turn_off');

    return html`
      <ha-card>
        <div class="content">
          <div class="toolbar">
            <span title=${device}">
              <ha-icon class="device-icon"
                       .icon="${deviceIcon}"></ha-icon>
            </span>
            <div class="name">${name}</div>
            <span title=${state.state}>
              <ha-icon class="power-icon"
                       .icon="${stateIcon}"></ha-icon>
            </span>
            <div class="toolbar-actions">
              ${isOn ? html`
                <ha-icon class="mute-icon"
                        .icon="${isMutedIcon}"
                        ?disabled=${!muteEnabled}
                        @click=${() => toggleMute()}></ha-icon>
                <ha-icon class="state-icon"
                         ?disabled=${!volumeEnabled}
                         icon="mdi:volume-minus"
                         @click=${() => volumeUp()}></ha-icon>
                <div class="volume-level">${volume}</div>
                <ha-icon class="state-icon"
                         ?disabled=${!volumeEnabled}
                         icon="mdi:volume-plus"
                         @click=${() => volumeDown()}></ha-icon>
              `: ''}
              <ha-icon class="power-button"
                       icon="mdi:power"
                       @click=${(ev) => togglePower()}></ha-icon>
            </div>
          </div>
        </div>
      </ha-card>
    `;
  }

  // styles
  static get styles() {
    return css`
      .content { padding: 2px 10px; }
      
      .toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .power-icon {
        opacity: 0.8;
        --mdc-icon-size: 20px;
      }

      .toolbar-actions {
        flex: 1;
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        align-items: center;
      }
      .toolbar-actions > ha-icon {
        cursor: pointer;
        --mdc-icon-size: 28px;
      }
      ha-icon:disabled {
        opacity: 0.5;
      }
    `;
  }
}

class MediaPlayerCardEditor extends ScopedRegistryHost(LitElement) {
  static elementDefinitions = {};
  static get properties() {
    return {
      hass: { attribute: false },
      config: { state: true }
    };
  }

  setConfig(config) {
    this.config = config;
  }

  firstUpdated() {
    MediaPlayerCardEditor.#loadHomeAssistantComponents(this, ['ha-entity-picker']);
  }

  get _entity() {
    return this.config?.entity || '';
  }

  render() {
    if (!this.config || !this.hass) {
      return nothing;
    }

    return html`
    <div class="container">
      <ha-entity-picker
        .hass=${this.hass}
        .includeDomains=${MediaPlayerCard.supportedDomains}
        .value=${this._entity}
        .configValue=${'entity'}
        .required=${true}
        @change=${this._valueChangedEntity}
      ></ha-entity-picker>
    </div>
    `;
  }

  _valueChangedEntity(ev) {
    const value =  ev.target?.value;
    if (value && this.config && this.hass) {
      const config = { ...this.config, entity: value };
      fireEvent(this, 'config-changed', { config });
    }
  }

  static async #loadHomeAssistantComponents(element, components) {
    const registry = element.shadowRoot?.customElements;
    if (registry) {
      const toBeLoaded = components.filter(x => !registry.get(x));
      if (toBeLoaded.length > 0) {
        const ch = await window.loadCardHelpers();
        const c = await ch.createCardElement({ type: "entities", entities: [] });
        await c.constructor.getConfigElement();

        toBeLoaded.forEach((component) => (registry.define(component, window.customElements.get(component))));
      }
    }
  }
}

customElements.define("simple-media-player-card", MediaPlayerCard);
customElements.define("simple-media-player-card-editor", MediaPlayerCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "simple-media-player-card",
  name: "Simple Media Player Card",
  description: "A simple card to manage media player on/off and volume!",
  //documentationURL: "https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card/",
});

/**
 * @typedef {{
 *   entity_id: string,
 *   state: string,
 *   attributes: {
 *     device_class: string,
 *     friendly_name: string,
 *     is_volume_muted: boolean,
 *     source_list: string[],
 *     supported_features: number,
 *     volume_level: number
 *   }
 * }} MediaPlayerState
 */
