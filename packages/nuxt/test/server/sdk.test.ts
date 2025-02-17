import * as SentryNode from '@sentry/node';
import type { NodeClient } from '@sentry/node';
import { Scope } from '@sentry/node';
import { getGlobalScope } from '@sentry/node';
import { SDK_VERSION } from '@sentry/node';
import type { EventProcessor } from '@sentry/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SentryNuxtServerOptions } from '../../src/common/types';
import { init } from '../../src/server';
import { clientSourceMapErrorFilter, mergeRegisterEsmLoaderHooks } from '../../src/server/sdk';

const nodeInit = vi.spyOn(SentryNode, 'init');

describe('Nuxt Server SDK', () => {
  describe('init', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('Adds Nuxt metadata to the SDK options', () => {
      expect(nodeInit).not.toHaveBeenCalled();

      init({
        dsn: 'https://public@dsn.ingest.sentry.io/1337',
      });

      const expectedMetadata = {
        _metadata: {
          sdk: {
            name: 'sentry.javascript.nuxt',
            version: SDK_VERSION,
            packages: [
              { name: 'npm:@sentry/nuxt', version: SDK_VERSION },
              { name: 'npm:@sentry/node', version: SDK_VERSION },
            ],
          },
        },
      };

      expect(nodeInit).toHaveBeenCalledTimes(1);
      expect(nodeInit).toHaveBeenLastCalledWith(expect.objectContaining(expectedMetadata));
    });

    it('returns client from init', () => {
      expect(init({})).not.toBeUndefined();
    });

    it('filters out low quality transactions', async () => {
      const beforeSendEvent = vi.fn(event => event);
      const client = init({
        dsn: 'https://public@dsn.ingest.sentry.io/1337',
      }) as NodeClient;
      client.on('beforeSendEvent', beforeSendEvent);

      client.captureEvent({ type: 'transaction', transaction: 'GET /' });
      client.captureEvent({ type: 'transaction', transaction: 'GET /_nuxt/some_asset.js' });
      // Although this has the name of the build asset directory (_nuxt), it should not be filtered out as it would not match the regex
      client.captureEvent({ type: 'transaction', transaction: 'GET _nuxt/some_asset.js' });
      client.captureEvent({ type: 'transaction', transaction: 'POST /_server' });

      await client!.flush();

      expect(beforeSendEvent).toHaveBeenCalledTimes(3);
      expect(beforeSendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: 'GET /',
        }),
        expect.any(Object),
      );
      expect(beforeSendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: 'GET _nuxt/some_asset.js',
        }),
        expect.any(Object),
      );
      expect(beforeSendEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: 'GET /_nuxt/some_asset.js',
        }),
        expect.any(Object),
      );
      expect(beforeSendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: 'POST /_server',
        }),
        expect.any(Object),
      );
    });

    it('registers an event processor', async () => {
      let passedEventProcessors: EventProcessor[] = [];
      const addEventProcessor = vi
        .spyOn(getGlobalScope(), 'addEventProcessor')
        .mockImplementation((eventProcessor: EventProcessor) => {
          passedEventProcessors = [...passedEventProcessors, eventProcessor];
          return new Scope();
        });

      init({
        dsn: 'https://public@dsn.ingest.sentry.io/1337',
      });

      expect(addEventProcessor).toHaveBeenCalledTimes(2);
      expect(passedEventProcessors[0]?.id).toEqual('NuxtLowQualityTransactionsFilter');
      expect(passedEventProcessors[1]?.id).toEqual('NuxtClientSourceMapErrorFilter');
    });
  });

  describe('clientSourceMapErrorFilter', () => {
    const options = { debug: false };
    const filter = clientSourceMapErrorFilter(options);

    describe('filters out errors', () => {
      it.each([
        [
          'source map errors with leading /',
          {
            exception: { values: [{ value: "ENOENT: no such file or directory, open '/path/to/_nuxt/file.js.map'" }] },
          },
        ],
        [
          'source map errors without leading /',
          { exception: { values: [{ value: "ENOENT: no such file or directory, open 'path/to/_nuxt/file.js.map'" }] } },
        ],
        [
          'source map errors with long path',
          {
            exception: {
              values: [
                {
                  value:
                    "ENOENT: no such file or directory, open 'path/to/public/_nuxt/public/long/long/path/file.js.map'",
                },
              ],
            },
          },
        ],
      ])('filters out %s', (_, event) => {
        // @ts-expect-error Event type is not correct in tests
        expect(filter(event)).toBeNull();
      });
    });

    describe('does not filter out errors', () => {
      it.each([
        ['other errors', { exception: { values: [{ value: 'Some other error' }] } }],
        ['events with no exceptions', {}],
        [
          'events without _nuxt in path',
          {
            exception: { values: [{ value: "ENOENT: no such file or directory, open '/path/to/other/file.js.map'" }] },
          },
        ],
        [
          'source map errors with different casing',
          {
            exception: { values: [{ value: "ENOENT: No Such file or directory, open '/path/to/_nuxt/file.js.map'" }] },
          },
        ],
        [
          'non-source-map file',
          { exception: { values: [{ value: "ENOENT: no such file or directory, open '/path/to/_nuxt/file.js'" }] } },
        ],
        ['events with no exception values', { exception: { values: [] } }],
        ['events with null exception value', { exception: { values: [null] } }],
      ])('does not filter out %s', (_, event) => {
        // @ts-expect-error Event type is not correct in tests
        expect(filter(event)).toEqual(event);
      });
    });
  });

  describe('mergeRegisterEsmLoaderHooks', () => {
    it('merges exclude array when registerEsmLoaderHooks is an object with an exclude array', () => {
      const options: SentryNuxtServerOptions = {
        registerEsmLoaderHooks: { exclude: [/test/] },
      };
      const result = mergeRegisterEsmLoaderHooks(options);
      expect(result).toEqual({ exclude: [/test/, /vue/] });
    });

    it('sets exclude array when registerEsmLoaderHooks is an object without an exclude array', () => {
      const options: SentryNuxtServerOptions = {
        registerEsmLoaderHooks: {},
      };
      const result = mergeRegisterEsmLoaderHooks(options);
      expect(result).toEqual({ exclude: [/vue/] });
    });

    it('returns boolean when registerEsmLoaderHooks is a boolean', () => {
      const options1: SentryNuxtServerOptions = {
        registerEsmLoaderHooks: true,
      };
      const result1 = mergeRegisterEsmLoaderHooks(options1);
      expect(result1).toBe(true);

      const options2: SentryNuxtServerOptions = {
        registerEsmLoaderHooks: false,
      };
      const result2 = mergeRegisterEsmLoaderHooks(options2);
      expect(result2).toBe(false);
    });

    it('sets exclude array when registerEsmLoaderHooks is undefined', () => {
      const options: SentryNuxtServerOptions = {};
      const result = mergeRegisterEsmLoaderHooks(options);
      expect(result).toEqual({ exclude: [/vue/] });
    });
  });
});
