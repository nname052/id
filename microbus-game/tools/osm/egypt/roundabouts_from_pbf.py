#!/usr/bin/env python3
"""دوائر الميادين (junction=roundabout) من ملف PBF بنفس شكل رد Overpass (out geom) اللي roundabouts.py بياخده"""
import json, sys
import osmium


class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__(); self.el = []

    def way(self, w):
        if w.tags.get('junction') != 'roundabout' or not w.is_closed(): return
        try:
            g = [dict(lat=n.lat, lon=n.lon) for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        self.el.append(dict(type='way', id=w.id, tags=dict(w.tags), geometry=g))


h = H(); h.apply_file(sys.argv[1], locations=True)
json.dump(dict(elements=h.el), open(sys.argv[2], 'w'), ensure_ascii=False)
print('roundabouts', len(h.el))
