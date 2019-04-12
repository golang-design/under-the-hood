all: clean
	# require install pygments
	latexmk -xelatex -shell-escape go-under-the-hood.tex
	make clean
clean:
	latexmk -c
	rm -rf condition.tex *.aux *.xdv *.dvi *.log *.out *.toc *.fdb_latexmk *.fls *.bbl *.blg
.PHONY: clean