source 'https://rubygems.org'

# sassc (a jekll dependency) is very slow to compile bc there are no alpine binaries
# https://github.com/sass/sassc-ruby/issues/189#issuecomment-629758948
# so for now sync used jekyll version with prebuilt binary available in alpine repo
gem "jekyll", "4.2.2" # installed by `gem jekyll`
# gem "webrick"        # required when using Ruby >= 3 and Jekyll <= 4.2.2

gem "just-the-docs", "0.4.0.rc3" # currently the latest pre-release
# gem "just-the-docs"            # the latest release - currently 0.3.3

gem "jekyll-readme-index"
gem 'jekyll-default-layout'
gem 'jekyll-titles-from-headings'
gem 'jekyll-relative-links'

group :jekyll_plugins do
  gem 'jekyll-optional-front-matter'
end
