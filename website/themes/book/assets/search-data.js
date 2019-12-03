'use strict';

(function() {
  const indexCfg = {{ with .Scratch.Get "bookSearchConfig" }}
    {{ . }};
  {{ else }}
   {};
  {{ end }}

  indexCfg.doc = {
    id: 'id',
    field: ['title', 'content'],
    store: ['title', 'href'],
  };

  const index = FlexSearch.create('balance', indexCfg);
  window.bookSearchIndex = index;

  {{ range $index, $page := .Site.Pages }}
  index.add({
    'id': {{ $index }},
    'href': '{{ $page.RelPermalink }}',
    'title': {{ (partial "zh-cn/title" $page) | jsonify }},
    'content': {{ $page.Plain | jsonify }}
  });
  {{- end -}}
})();
