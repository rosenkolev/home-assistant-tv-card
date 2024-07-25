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

class MediaPlayerState {
  set state(state) { this._state = state; }
  get name() { return this._state.attributes.friendly_name; }
  get volumeEnabled() { return this.isFeatureOn(4); } // VOLUME_SET: 4
  get muteEnabled() { return this.isFeatureOn(8); }   // VOLUME_MUTE: 8
  get powerEnabled() { return this.isFeatureOn(128); } // TURN_ON: 128, TURN_OFF: 256
  get sourceEnabled() { return this.isFeatureOn(2048); } // SELECT_SOURCE: 2048
  get isOn() { return this._state.state === 'on'; }
  get isOff() { return this._state.state === 'off'; }
  get volume() { return this._state.attributes.volume_level * 100 }
  get isMuted() { return this._state.attributes.is_volume_muted; }
  get isMutedIcon() { return this.isMuted ? 'mdi:volume-off' : 'mdi:volume-high' }
  get sources() { return this._state.attributes.source_list; }
  get device() { return this._state.attributes.device_class; }
  get deviceIcon() { return this.device === 'tv' ? 'mdi:television' : 'mdi:cast-variant' }
  get stateIcon() { return this._state.state === 'off' ? 'mdi:power-plug-off-outline' : this._state.state === 'idle' ? 'mdi:power-sleep' : 'mdi:power'; }
  get stateName() { return this._state.state; }

  isFeatureOn(feature) { return (this._state.attributes.supported_features & feature) === feature; }
}

/** create a query selectors with cached results.
 * @example queryable(this.shadowRoot)('.my-class')(); // returns the .my-class element
 */
function queryable(elementFn) {
  const queries = new Map();
  function select(selector) {
    if (queries.has(selector)) {
      return queries.get(selector);
    } else {
      const element = elementFn().querySelector(selector);
      queries.set(selector, element);
      return element;
    }
  }
  return function (selector) {
    return select.bind(null, selector);
  };
}

function CardActionsTracker(actions, options) {
  const state = new Set();
  const { hassFn, entityIdFn } = options;
  const disable = (query) => query().removeAttribute('disabled');
  function call(action, args, domain) {
    return hassFn().callService(domain || 'media_player', action, { entity_id: entityIdFn(), ...args });
  }
  function actionHandler(name, ...args) {
    const opts = actions[name];
    if (opts.singleExecution) {
      if (state.has(name)) {
        console.error(`action ${name} is performing`);
        return;
      }

      state.add(name);
      opts.affectedControlQueries.forEach((query) => query().setAttribute('disabled', ''));
    }

    const promise = opts.do(call, ...args);
    if (options.singleExecution) {
      promise.finally(() => {
        state.delete(name);
        if (opts.autoRestoreOnCallback) {
          opts.affectedControlQueries.forEach(disable);
        }
      }).catch(() => (opts.affectedControlQueries.forEach(disable)));
    }
    if (options.hapticFeedback) {
      fireEvent(window, "haptic", "light")
    }
  }

  Object.keys(actions).forEach((name) => (this[name] = actionHandler.bind(this, name)));
  this.reset = () => {
    state.forEach((name) => (actions[name].affectedControlQueries.forEach(disable)));
    state.clear();
  };
}

class MediaPlayerCard extends LitElement {
  static supportedDomains = ['media_player'];
  static get properties() {
    return {
      hass: { attribute: false },
      config: { state: true }
    };
  }

  static getConfigElement() {
    return document.createElement('simple-media-player-card2-editor');
  }

  static getStubConfig() {
    return { entity: "media_player.samsung_tv" };
  }

  #query = queryable(() => this.shadowRoot);
  #state = new MediaPlayerState();
  #actions = new CardActionsTracker({
    power: {
      do: (call) => this.#state.isOff ? call('turn_on') : call('turn_off'),
      singleExecution: true,
      autoRestoreOnCallback: true,
      affectedControlQueries: [this.#query('.power-button')]
    },
    mute: {
      do: (call) => call('volume_mute', { is_volume_muted: !this.#state.isMuted }),
      singleExecution: true,
      affectedControlQueries: [this.#query('.mute-icon')]
    },
    volumeUp: {
      do: (call) => call('volume_up')
    },
    volumeDown: {
      do: (call) => call('volume_down')
    }
  }, {
    hassFn: () => this.hass,
    entityIdFn: () => this.config.entity,
    hapticFeedback: true,
  });

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

  /** Get the card size. (x * 50px) */
  getCardSize() { return 3; }

  shouldUpdate(changedProps) {
    return this.config && this.hass && hasConfigOrEntityChanged(this, changedProps, false);
  }

  render() {
    if (!this.config || !this.hass) {
      return nothing;
    }

    this.#state.state = this.hass.states[this.config.entity];
    const _ = this.#state;
    return html`
      <ha-card>
        <div class="content">
          <div class="toolbar">
            <span title=${_.device}">
              <ha-icon class="device-icon"
                       .icon="${_.deviceIcon}"></ha-icon>
            </span>
            <div class="name">${_.name}</div>
            <span title=${_.stateName}>
              <ha-icon class="power-icon"
                       .icon="${_.stateIcon}"></ha-icon>
            </span>
            <div class="toolbar-actions">
              ${_.isOn ? html`
                <ha-icon class="mute-icon"
                        .icon="${_.isMutedIcon}"
                        ?disabled=${!_.muteEnabled}
                        @click=${() => this.#actions.mute()}></ha-icon>
                <ha-icon class="state-icon"
                         ?disabled=${!_.volumeEnabled}
                         icon="mdi:volume-minus"
                         @click=${() => this.#actions.volumeUp()}></ha-icon>
                <div class="volume-level">${_.volume}</div>
                <ha-icon class="state-icon"
                         ?disabled=${!_.volumeEnabled}
                         icon="mdi:volume-plus"
                         @click=${() => this.#actions.volumeDown()}></ha-icon>
              `: ''}
              <ha-icon class="power-button"
                       icon="mdi:power"
                       @click=${(ev) => this.#actions.power()}></ha-icon>
            </div>
          </div>
        </div>
      </ha-card>
    `;
  }

  updated() {
    this.#actions.reset();
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

customElements.define("simple-media-player-card2", MediaPlayerCard);
customElements.define("simple-media-player-card2-editor", MediaPlayerCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "simple-media-player-card2",
  name: "Simple Media Player Card Extended",
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