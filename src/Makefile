all: clean
	# require install pygments
	latexmk -xelatex -shell-escape go-under-the-hood.tex
	latexmk -c
	make clean
clean:
	rm -rf condition.tex *.aux *.dvi *.log *.out *.toc *.fdb_latexmk *.fls *.bbl *.blg
.PHONY: clean