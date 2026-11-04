import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getCityZonePlacementError,
  getRequiredCityZone,
  isFootprintInCityZone,
  type CityZone,
} from './city';

const city = { centerX: 1000, centerY: 1000 };

describe('municipal zones', () => {
  it('accepts rectangles on the municipal boundary and rejects rectangles outside it', () => {
    assert.equal(
      getCityZonePlacementError(
        { minX: 849, minY: 849, maxX: 1151, maxY: 1151 },
        city,
        [],
      ),
      null,
    );
    assert.equal(
      getCityZonePlacementError(
        { minX: 848, minY: 849, maxX: 850, maxY: 850 },
        city,
        [],
      ),
      'zone_outside_municipality',
    );
  });

  it('rejects shared tiles between zones but allows adjacent rectangles', () => {
    const existing = [{ minX: 840, minY: 900, maxX: 850, maxY: 910 }];
    assert.equal(
      getCityZonePlacementError(
        { minX: 850, minY: 900, maxX: 860, maxY: 910 },
        city,
        existing,
      ),
      'zone_overlap',
    );
    assert.equal(
      getCityZonePlacementError(
        { minX: 851, minY: 900, maxX: 860, maxY: 910 },
        city,
        existing,
      ),
      null,
    );
  });

  it('maps construction categories to the required region type', () => {
    assert.equal(getRequiredCityZone('artesanais'), 'urban');
    assert.equal(getRequiredCityZone('comerciais'), 'urban');
    assert.equal(getRequiredCityZone('residencias'), 'urban');
    assert.equal(getRequiredCityZone('fazendas'), 'rural');
    assert.equal(getRequiredCityZone('recursos'), 'rural');
    assert.equal(getRequiredCityZone('industrias'), 'rural');
    assert.equal(getRequiredCityZone('prefeitura'), null);
  });

  it('requires every footprint tile to fit inside the required zone type', () => {
    const urban: CityZone = {
      id: 'urban',
      cityId: 'city',
      type: 'urban',
      minX: 10,
      minY: 10,
      maxX: 20,
      maxY: 20,
    };
    const footprint = [
      { minX: 11, minY: 11, maxX: 11, maxY: 11 },
      { minX: 12, minY: 11, maxX: 12, maxY: 11 },
    ];
    assert.equal(isFootprintInCityZone(footprint, [urban], 'urban'), true);
    assert.equal(isFootprintInCityZone(footprint, [urban], 'rural'), false);
    assert.equal(
      isFootprintInCityZone([...footprint, { minX: 21, minY: 11, maxX: 21, maxY: 11 }], [urban], 'urban'),
      false,
    );
  });
});
