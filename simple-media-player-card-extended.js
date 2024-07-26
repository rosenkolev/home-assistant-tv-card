import { ScopedRegistryHost } from 'https://unpkg.com/@lit-labs/scoped-registry-mixin@1.0.3/scoped-registry-mixin.js?module';
import {
  LitElement,
  html,
  css,
  nothing
} from "https://unpkg.com/lit-element@3.3.3/lit-element.js?module";

import { 
  computeDomain,
  computeEntity,
  hasConfigOrEntityChanged,
  fireEvent,
  forwardHaptic
} from 'https://unpkg.com/custom-card-helpers@1.9.0/dist/index.m.js?module';

class MediaPlayerStateAccessor {
  /** @param {MediaPlayerState} state */
  set state(state) { this._state = state; }
  get state() { return this._state; }
  get name() { return this._state.attributes.friendly_name; }
  get volumeEnabled() { return this.isFeatureOn(4); } // VOLUME_SET: 4
  get muteEnabled() { return this.isFeatureOn(8); }   // VOLUME_MUTE: 8
  get powerEnabled() { return this.isFeatureOn(128); } // TURN_ON: 128, TURN_OFF: 256
  get sourceEnabled() { return this.isFeatureOn(2048); } // SELECT_SOURCE: 2048
  get isOn() { return this._state.state === 'on'; }
  get isOff() { return this._state.state === 'off'; }
  get volume() { return Math.round(this._state.attributes.volume_level * 100); }
  get isMuted() { return this._state.attributes.is_volume_muted; }
  get isMutedIcon() { return this.isMuted ? 'mdi:volume-off' : 'mdi:volume-high' }
  get sources() { return this._state.attributes.source_list; }
  get device() { return this._state.attributes.device_class; }
  get deviceIcon() {
    switch (this.device) {
      case 'tv': return this.isOn ? 'mdi:television' : 'mdi:television-off';
      case 'speaker': return this.isOn ? 'mdi:speaker' : 'mdi:speaker-off';
      case 'receiver': return this.isOn ? 'mdi:audio-video' : 'mdi:audio-video-off';
      default: return this.isOn ? 'mdi:cast' : 'mdi:cast-off';
    }
  }
  get deviceIconTitle() { return `${this.device} ${this.stateName}`; }
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
    return hassFn().callService(domain || 'media_player', action, Object.assign({ entity_id: entityIdFn()}, args));
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
      forwardHaptic('light');
    }
  }

  Object.keys(actions).forEach((name) => (this[name] = actionHandler.bind(this, name)));
  this.reset = () => {
    state.forEach((name) => (actions[name].affectedControlQueries.forEach(disable)));
    state.clear();
  };
}

class MediaPlayerCard extends LitElement {
  static expressionRegex = /([a-zA-Z0-9_\-\.]+)\s*((==)|(!=)|(\^=)|(\$=)|(\*=))\s*([a-zA-Z0-9]+)*/;
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
  #state = new MediaPlayerStateAccessor();
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
    },
    command: {
      do: (call, type, value) => {
        if (type === 'app') {
          return call('play_media', {
            media_content_id: value,
            media_content_type: 'app'
          });
        } else if (type === 'key') {
          return call('play_media', {
            media_content_id: value,
            media_content_type: "send_key"
          });
        } else if (type === 'command') {
          const entity = computeEntity(this.config.entity);
          const entity_id = `remote.${entity}`;
          if (this.hass.entities[entity_id]) {
            return call('send_command', { command: value, entity_id }, 'remote');
          }
        } else if (type === 'source') {
          return call('select_source', {
            source: value
          });
        } else if (type === 'custom') {
          const [command, id] = value.split('|');
          return call('play_media', {
            media_content_id: id,
            media_content_type: command
          });
        }
      }
    }
  }, {
    hassFn: () => this.hass,
    entityIdFn: () => this.config.entity,
    hapticFeedback: true,
  });

  /** @param {MediaPlayerCardUserConfig} config */
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
  getCardSize() { return 2; }

  shouldUpdate(changedProps) {
    return this.config && this.hass && hasConfigOrEntityChanged(this, changedProps, false);
  }

  render() {
    if (!this.config || !this.hass) {
      return nothing;
    }

    this.#state.state = this.hass.states[this.config.entity];
    const _ = this.#state;
    const bars = this.config.bars || [];
    const classMap = (obj) => Object.entries(obj).filter(([, value]) => value).map(([key]) => key).join(' ');
    const getIcon = (key) => key.iconExpression ? (this.#exp(key.iconExpression) ? key.icon : key.iconOff) : key.icon;
    return html`
      <ha-card>
        <div class="content">
          <div class="toolbar">
            <span title=${_.deviceIconTitle}>
              <ha-icon class="device-icon"
                       .icon="${_.deviceIcon}"></ha-icon>
            </span>
            <div class="name">${this.config.title || _.name}</div>
            <div class="toolbar-actions">
              ${_.isOn ? html`
                <ha-icon class="mute-icon btn"
                        .icon="${_.isMutedIcon}"
                        ?disabled=${!_.muteEnabled}
                        @click=${() => this.#actions.mute()}></ha-icon>
                <ha-icon class="state-icon btn"
                         ?disabled=${!_.volumeEnabled}
                         icon="mdi:volume-minus"
                         @click=${() => this.#actions.volumeDown()}></ha-icon>
                <div class="volume-level">${_.volume}</div>
                <ha-icon class="state-icon btn"
                         ?disabled=${!_.volumeEnabled}
                         icon="mdi:volume-plus"
                         @click=${() => this.#actions.volumeUp()}></ha-icon>
              `: ''}
              <ha-icon class="power-button btn"
                       icon="mdi:power"
                       @click=${(ev) => this.#actions.power()}></ha-icon>
            </div>
          </div>
          ${bars.map((bar) => html`
            <div class=${classMap({
                          footer: true,
                          'flex-between': bar.align === 'between',
                          'flex-evenly': bar.align === 'evenly' })}>
              ${(bar.items || []).filter(x => x.icon).map((key) => html`
                <ha-icon class="btn"
                         ?disabled=${this.#exp(key.disabled)}
                         .icon=${getIcon(key)}
                         title=${key.title || key.value}
                         @click=${() => this.#actions.command(key.type, key.value)}></ha-icon>
              `)}
            </div>
          `)}
        </div>
      </ha-card>
    `;
  }

  updated() {
    this.#actions.reset();
  }

  #exp(expression) {
    if (typeof expression !== 'string') return false;
    const match = MediaPlayerCard.expressionRegex.exec(expression);
    if (match) {
      const key = match[1];
      const left = this.#state.state.attributes[key];
      const operator = match[2];
      const right = match[match.length-1];
      if (typeof left === 'undefined' || typeof right === 'undefined') return false;
      switch (operator) {
        case '==': return left === right;
        case '!=': return left !== right;
        case '^=': return left.startsWith(right);
        case '$=': return left.endsWith(right);
        case '*=': return left.includes(right);
        default: return false;
      }
    }
  }

  // styles
  static get styles() {
    return css`      
      .toolbar, .footer, .toolbar-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
        .toolbar {
          padding: 3px 10px;
        }
        .footer {
          border-top: 1px solid #EEE;
          padding: 3px 2px;
        }
        .toolbar-actions {
          flex: 1;
          justify-content: flex-end;
        }

      .flex-between { justify-content: space-between; }
      .flex-evenly { justify-content: space-evenly; }
      .btn {
        cursor: pointer;
        --mdc-icon-size: 34px;
        padding: 3px;
      }
      .btn:disabled {
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
    MediaPlayerCardEditor.#loadHomeAssistantComponents(this, ['ha-entity-picker', 'ha-textfield']);
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
        @change=${this._valueChanged}
      ></ha-entity-picker>
      <ha-textfield
        .label=${'Title'}
        .value=${this.config.title}
        .configValue=${'title'}
        @input=${this._valueChanged}
      ></ha-textfield>
      <p></p>
      <details>
        <summary>Debug</summary>
        <div class="debug">
          <input id="debugService" value="media_player.play_media" />
          <input id="debugData" .value=${"{ \"media_content_type\": \"app\", \"media_content_id\": \"11101200001\" }"} />
          <button @click=${() => this._debugCall()}>Test</button><button @click=${() => console.log(this.hass)}>Print HASS</button>
        </div>
      </details>
    </div>
    `;
  }

  _debugCall() {
    const [domain, command] = this.shadowRoot.querySelector('#debugService').value.split('.');
    const data = JSON.parse(this.shadowRoot.querySelector('#debugData').value);
    const entity = computeEntity(this.config.entity);
    const entity_id = `${domain}.${entity}`;
    console.log(`debug: ${domain}.${command}`, { entity_id, ...data });
    this.hass.callService(domain, command, { entity_id, ...data }).then((x) => console.log(`debug: ${domain}.${command}`, x), console.error);
  }

  _valueChanged(ev) {
    ev.stopPropagation();
    const target = ev.target;
    if (target && this.hass && this.config) {
      const key = target.configValue;
      const value = target.value ?? target.checked;
      if (this.config[key] !== value) {
        const config = { ...this.config, [key]: value };
        fireEvent(this, 'config-changed', { config });
      }
    }
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

  static get styles() {
    return css`
      .container > * {
        display: block;
        width: 100%;
        padding-bottom: 10px;
      }
    `;
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
/**
 * @typedef {{
 *   icon: string,
 *   iconExpression: string || undefined,
 *   iconOff: string || undefined,
 *   title: string || undefined,
 *   disabled: string || undefined,
 *   type: 'app' || 'key' || 'command' || 'source' || 'custom' || undefined,
 *   value: string || undefined
 * }} CustomKey
 */
/** 
 * @typedef {{
 *  entity: string,
 *  title: string || undefined,
 *  bars: {
 *    align: 'evenly' || 'between' || undefined,
 *    items: CustomKey[]
 *  }
 * }} MediaPlayerCardUserConfig
 */
