const { METHODS } = require('http');
const { Stream } = require('stream');
const { stringify, parse } = require('querystring');
const fetch = require('node-fetch');
const { Headers } = fetch;
const FormData = require('./forms/FormData');
const URLConstructor = typeof URL !== 'undefined' ? URL : require('url').URL;

const NO_BODY = ['get', 'head'];
const ERROR_MESSAGES = {
	ENOTFOUND: [404, req => `Request to ${req.options.url.href} failed: Host not Found`],
	ECONNREFUSED: [500, req => `Request to ${req.options.url.href} failed: Connection Refused`]
};

class Chainfetch {

	constructor(method, url, options = {}) {
		this.options = {
			method: method.toLowerCase(),
			url: new URLConstructor(url),
			...options,
			headers: new Headers(),
			body: null,
			query: undefined,
			redirect: 'follow',
			follow: 20,
			timeout: 0,
			compress: true,
			agent: undefined
		};
		if (options.headers) this.set(options.headers);
		if (options.query) this.query(options.query);
		if (options.body) this.send(options.body);

		const oldLimit = Error.stackTraceLimit;
		Error.stackTraceLimit = 3;

		Object.defineProperties(this, {
			customHandler: {
				writable: true,
				enumerable: false,
				value: 'json'
			},
			error: {
				writable: true,
				enumerable: false,
				value: new Error()
			}
		});

		Error.captureStackTrace(this.error);
		Error.stackTraceLimit = oldLimit;
	}

	query(name, value) {
		if (Array.isArray(name)) {
			for (const [k, v] of name) {
				this.options.url.searchParams.set(k, v);
			}
		} else if (name && name.constructor === Object) {
			for (const [k, v] of Object.entries(name)) {
				this.options.url.searchParams.set(k, v);
			}
		} else {
			this.options.url.searchParams.set(name, value);
		}
		return this;
	}

	set(name, value) {
		if (Array.isArray(name)) {
			for (const [k, v] of name) {
				this.options.headers.set(k.toLowerCase(), v);
			}
		} else if (name && name.constructor === Object) {
			for (const [k, v] of Object.entries(name)) {
				this.options.headers.set(k.toLowerCase(), v);
			}
		} else {
			this.options.headers.set(name.toLowerCase(), value);
		}
		return this;
	}

	attach(...args) {
		const form = this.options.body instanceof FormData ? this.options.body : this.options.body = new FormData();
		if (args[0] && args[0].constructor === Object) {
			for (const [k, v] of Object.entries(args[0])) {
				this.attach(k, v);
			}
		} else {
			form.append(...args);
		}
		return this;
	}

	send(data) {
		if (data instanceof FormData || Buffer.isBuffer(data) || data instanceof Stream) {
			this.options.body = data;
		} else if (data !== null && typeof data === 'object') {
			const header = this.options.headers.get('content-type');
			let serialize;
			if (header) {
				if (header.includes('application/json')) {
					serialize = JSON.stringify;
				} else if (header.includes('urlencoded')) {
					serialize = stringify;
				}
			} else {
				this.set('Content-Type', 'application/json');
				serialize = JSON.stringify;
			}
			this.options.body = serialize(data);
		} else {
			this.options.body = data;
		}
		return this;
	}

	setRedirect(redirect) {
		this.options.redirect = redirect;
		return this;
	}

	setFollowCount(count) {
		this.options.follow = count || 20;
		return this;
	}

	setTimeout(timeout) {
		this.options.timeout = typeof timeout === 'number' ? timeout : 0;
		return this;
	}

	setAgent(agent) {
		this.options.agent = agent;
		return this;
	}

	toBuffer() {
		this.customHandler = 'buffer';
		return this;
	}

	toJSON() {
		this.customHandler = 'json';
		return this;
	}

	toText() {
		this.customHandler = 'text';
		return this;
	}

	toString() {
		return this.toText();
	}

	then(resolver, rejecter) {
		if (this._response) return this._response.then(resolver, rejecter);

		if (this.options.body instanceof FormData) this.set('Content-Type', `multipart/form-data; boundary=${this.options.body.boundary}`);

		// eslint-disable-next-line no-return-assign
		return this._response = new Promise(async (resolve, reject) => {
			const returnRes = {
				headers: new Headers(),
				status: 0,
				statusText: 'Uncaught Error. You should report this to the GitHub!',
				ok: false,
				url: '',
				body: null
			};

			Object.defineProperty(returnRes, 'rawBody', {
				enumerable: false,
				writable: true
			});

			try {
				const res = await fetch(this.options.url.href, {
					method: this.options.method,
					headers: this.options.headers,
					redirect: this.options.redirect,
					follow: this.options.follow,
					timeout: this.options.timeout,
					compress: this.options.compress,
					agent: this.options.agent,
					body: NO_BODY.includes(this.options.method) ? undefined : this.options.body instanceof FormData ? this.options.body.end() : this.options.body
				});
				returnRes.headers = res.headers;
				returnRes.status = res.status;
				returnRes.statusText = res.statusText;
				returnRes.url = res.url;
				returnRes.ok = res.ok;
				let finalBody = await res.buffer();
				returnRes.rawBody = finalBody;

				if (this.customHandler !== 'buffer') {
					const type = returnRes.headers.get('content-type');
					if (/application\/json/.test(type) || this.customHandler === 'json') {
						try {
							finalBody = JSON.parse(String(finalBody));
						} catch (_unused) {
							finalBody = String(finalBody);
						}
					} else if (/application\/x-www-form-urlencoded/.test(type)) {
						finalBody = parse(String(finalBody));
					} else if (this.customHandler === 'text') {
						finalBody = String(finalBody);
					}
				}

				returnRes.body = finalBody;
				if (res.ok) return resolve(returnRes);
				throw new Error();
			} catch (err) {
				if (err.code) {
					const [status, statusText] = ERROR_MESSAGES[err.code];
					returnRes.status = status;
					returnRes.statusText = typeof statusText === 'function' ? statusText(this) : statusText;
				}
				this.error.message = `${returnRes.status}: ${returnRes.statusText}`.trim();
				Object.assign(this.error, returnRes);
				return reject(this.error);
			}
		}).then(resolver, rejecter);
	}

	catch(rejecter) {
		return this.then(null, rejecter);
	}

}

Chainfetch.METHODS = METHODS.filter((method) => method !== 'M-SEARCH');
for (const method of Chainfetch.METHODS) {
	Chainfetch[method.toLowerCase()] = function httpMethod(url, opts) {
		const Constructor = this && this.prototype instanceof Chainfetch ? this : Chainfetch;
		return new Constructor(method, url, opts);
	};
}

module.exports = Chainfetch;
